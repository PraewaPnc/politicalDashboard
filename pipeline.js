// pipeline.js

const fs = require('fs/promises'); // Use fs.promises for async file operations
const path = require('path');
const fetch = require('node-fetch');

// ===============================
// Constants (Adapted for Node.js)
// ===============================
const GRAPHQL_ENDPOINT = "https://politigraph.wevis.info/graphql";

// Server-side cache directory and file names
const CACHE_DIR = path.join(__dirname, 'data_cache');
const VOTE_CACHE_FILE = path.join(CACHE_DIR, 'vote_data_cache.json');
const ORG_CACHE_FILE = path.join(CACHE_DIR, 'organizations_cache.json');
const PARTY_MAP_FILE = path.join(__dirname, 'cleaned_party_map.json'); // Assumed path for the map

// Configuration for the retry mechanism
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1 second base delay

// ===============================
// GraphQL Queries (Unchanged)
// ===============================
const QUERY_VOTE_EVENTS = `
  query VoteEvents {
    voteEvents {
      start_date
      title
      description
      result
      agree_count
      disagree_count
      abstain_count
      novote_count
      result
      votes {
        id
        voter_name
        voter_party
        option_en
      }
    }
  }
`;

const QUERY_ORGANIZATIONS = `
  query Organizations {
    organizations {
      id
      name
      color
    }
  }
`;

// ===============================
// Utility Functions
// ===============================
const isAbsent = (option) => {
  if (!option) return false;
  const t = String(option).toLowerCase();
  return t.includes("absent") || t.includes("ไม่อยู่");
};

// Safe JSON Parse is not strictly needed for Node.js but kept for consistency
const safeJSONParse = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

/**
 * Sleeps for a given number of milliseconds.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===============================
// GraphQL Fetcher (Adapted for Node.js with Retry)
// ===============================
async function fetchGraphQL(query) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const isLastAttempt = attempt === MAX_RETRIES;
    
    try {
      console.log(`Attempt ${attempt}/${MAX_RETRIES}: Fetching GraphQL data...`);
      const res = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        timeout: 60000 // Set a request timeout (60s)
      });

      // 1. Check for non-2xx status codes (e.g., 500, 503)
      if (!res.ok) {
        const statusText = res.statusText || 'Unknown Status';
        const errorMsg = `HTTP Error ${res.status}: ${statusText}.`;
        
        if (isLastAttempt) {
            throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error: ${errorMsg}`);
        }
        
        console.warn(`Warning: GraphQL fetch failed with status ${res.status}. Retrying...`);
        // Exponential backoff delay
        await sleep(BASE_DELAY_MS * (2 ** (attempt - 1))); 
        continue;
      }

      // 2. Check for non-JSON responses (like the HTML error you saw)
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const rawText = await res.text();
        const errorMsg = `Received non-JSON content. Content Type: ${contentType}. Start of response: ${rawText.substring(0, 50)}...`;
        
        if (isLastAttempt) {
             throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error: ${errorMsg}`);
        }

        console.warn(`Warning: ${errorMsg} Retrying...`);
        await sleep(BASE_DELAY_MS * (2 ** (attempt - 1)));
        continue;
      }


      // 3. Process JSON response
      const json = await res.json();
      if (json.errors) {
        // Log the server-side GraphQL errors (no retry needed as connection was successful)
        console.error("GraphQL Errors:", json.errors);
        return {}; 
      }
      
      console.log(`Successfully fetched data on attempt ${attempt}.`);
      return json.data || {};

    } catch (err) {
      // Catches network errors (DNS, timeouts, connection refused, etc.)
      console.error(`GraphQL fetch error on attempt ${attempt}:`, err.message);
      
      if (isLastAttempt) {
        console.error(`❌ Final GraphQL fetch failed after ${MAX_RETRIES} attempts.`);
        return {};
      }

      // Exponential backoff delay
      const delay = BASE_DELAY_MS * (2 ** (attempt - 1));
      console.log(`Waiting for ${delay}ms before retrying...`);
      await sleep(delay); 
    }
  }

  // Fallback return if the loop finishes without success
  return {}; 
}

/**
 * Node.js: Fetches the cleaned party map from a local file.
 */
async function fetchCleanedPartyMap() {
  try {
    const raw = await fs.readFile(PARTY_MAP_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Could not load party cleaning map from ${PARTY_MAP_FILE}. Defaulting to {}. Error: ${err.message}`);
    return {};
  }
}

// ===============================
// Vote Event Transformation (Unchanged)
// ===============================
function transformVoteEvents(rawEvents, cleanedPartyMap = {}) {
  if (!Array.isArray(rawEvents)) return [];

  return rawEvents.map((ev) => {
    const start_date = ev.start_date?.slice(0, 10) || null;
    const dt = start_date ? new Date(start_date) : null;
    const year = dt?.getUTCFullYear() || null;
    const month = dt ? dt.getUTCMonth() + 1 : null;

    const votes = Array.isArray(ev.votes)
      ? ev.votes.map((v) => {
          const voteId = v.id;
          const original_party = v.voter_party ?? "อื่นๆ";
          const cleaned_party = cleanedPartyMap[voteId] || original_party; // Look up cleaned party name
          
          return {
            id: voteId,
            voter_name: v.voter_name ?? "__UNKNOWN__",
            voter_party: cleaned_party ?? "อื่นๆ", // Use the cleaned party name
            option_en: v.option_en ?? "",
          }
        })
      : [];

    const unique = new Map(votes.map((v) => [v.voter_name, v]));
    const totalVoters = unique.size;
    let presentCount = 0;
    const partyBreakdown = {};  
    const totalByParty = {};

    for (const { voter_party, option_en } of unique.values()) {
      totalByParty[voter_party] = (totalByParty[voter_party] || 0) + 1;
      if (!isAbsent(option_en)) {
        presentCount++;
        partyBreakdown[voter_party] = (partyBreakdown[voter_party] || 0) + 1;
      }
    }

    const presentPercent = totalVoters
      ? +(presentCount / totalVoters * 100).toFixed(1)
      : 0;

    const agree = +ev.agree_count || 0;
    const disagree = +ev.disagree_count || 0;
    const abstain = +ev.abstain_count || 0;
    const novote = +ev.novote_count || 0;
    const totalVotes = agree + disagree + abstain + novote || 0;

    const categoryPercentages = totalVotes
      ? {
          agree: +(agree / totalVotes * 100).toFixed(1),
          disagree: +(disagree / totalVotes * 100).toFixed(1),
          abstain: +(abstain / totalVotes * 100).toFixed(1),
          novote: +(novote / totalVotes * 100).toFixed(1),
        }
      : { agree: 0, disagree: 0, abstain: 0, novote: 0 };

    return {
      date: dt,
      dateStr: start_date,
      year,
      month,
      title: ev.title ?? "Untitled",
      description: ev.description ?? "No description",
      result: ev.result ?? null,
      agree_count: agree,
      disagree_count: disagree,
      abstain_count: abstain,
      novote_count: novote,
      totalVotes,
      categoryPercentages,
      votes,
      totalVoters,
      presentCount,
      presentPercent,
      partyBreakdown,
      totalByParty,
      result: ev.result ?? null,
    };
  }).sort((a, b) =>
    (a.dateStr || "").localeCompare(b.dateStr || "") ||
    a.title.localeCompare(b.title)
  );
}


// ===============================
// Pipeline Functions
// ===============================

/**
 * Fetches, processes, and saves the final Vote Event data to a file.
 */
async function runVotePipeline() {
  console.log("Starting Vote Data pipeline...");
  await fs.mkdir(CACHE_DIR, { recursive: true }); // Ensure cache directory exists

  // 1. Fetch data
  const { voteEvents = [] } = await fetchGraphQL(QUERY_VOTE_EVENTS);

  if (!voteEvents.length) {
    console.error("❌ Failed to fetch fresh vote data from GraphQL. Aborting file write.");
    return false;
  }

  // 2. Fetch required helper data
  const cleanedPartyMap = await fetchCleanedPartyMap();

  // 3. Process/Transform data
  console.log("Processing vote events...");
  const records = transformVoteEvents(voteEvents, cleanedPartyMap);

  // 4. Store processed data to local file (The 'local folder' staging)
  // We include a timestamp for reference, but the client uses the 'data' property
  const payload = { timestamp: Date.now(), data: records };
  await fs.writeFile(VOTE_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`✅ Vote data saved (${records.length} records) to: ${VOTE_CACHE_FILE}`);
  return true;
}

/**
 * Fetches and saves the Organizations data to a file.
 */
async function runOrgPipeline() {
    console.log("Starting Organizations Data pipeline...");
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const { organizations = [] } = await fetchGraphQL(QUERY_ORGANIZATIONS);

    if (!organizations.length) {
        console.error("❌ Failed to fetch fresh organizations. Aborting file write.");
        return false;
    }

    // No transformation needed, just save
    const payload = { timestamp: Date.now(), data: organizations };
    await fs.writeFile(ORG_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');

    console.log(`✅ Organizations data saved (${organizations.length} records) to: ${ORG_CACHE_FILE}`);
    return true;
}


// --- Execute the Pipeline ---
(async () => {
    try {
        console.log("--- Data Pipeline Start ---");
        await runOrgPipeline();
        await runVotePipeline();
        console.log("--- Pipeline Completed Successfully ---");
        process.exit(0);
    } catch (error) {
        console.error("\n💥 Pipeline failed entirely:", error.message);
        process.exit(1);
    }
})();
