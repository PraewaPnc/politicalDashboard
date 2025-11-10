import stringSimilarity from "string-similarity";

// ===============================
// Constants
// ===============================
const GRAPHQL_ENDPOINT = "https://politigraph.wevis.info/graphql";

// Vote Events cache
const CACHE_KEY = "voteDataCache_v1";
const STAGING_KEY = "voteDataStaging_v1";

// Organizations cache
const ORG_CACHE_KEY = "orgCache_v1";
const ORG_STAGING_KEY = "orgStaging_v1";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// ===============================
// GraphQL Queries
// ===============================
const QUERY_VOTE_EVENTS = `
  query VoteEvents {
    voteEvents {
      start_date
      title
      agree_count
      disagree_count
      abstain_count
      novote_count
      result
      votes {
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

const safeJSONParse = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

// --- Cleaning function similar to Python clean_text ---
function cleanText(s) {
  if (s === null || s === undefined) return s;
  s = String(s).trim();
  s = s.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, ''); // Remove strange chars except Thai/English/digits/space
  s = s.replace(/\s+/g, ''); // Remove all whitespace
  return s;
}

// --- Fuzzy matching function similar to Python to_canonical ---
function toCanonical(s, canonList, cutoff = 0.6) {
  if (!s || s === '') return s;
  const matches = stringSimilarity.findBestMatch(s, canonList);
  if (matches.bestMatch.rating >= cutoff) {
    return matches.bestMatch.target;
  }
  return s; // fallback keep original
}

// ===============================
// Cache & Staging Helpers
// ===============================
function readStorage(key, checkTTL = false) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const obj = safeJSONParse(raw);
  if (!obj) return null;

  if (checkTTL && (!obj.timestamp || Date.now() - obj.timestamp > CACHE_TTL)) {
    localStorage.removeItem(key);
    return null;
  }

  return checkTTL ? obj.data : obj;
}

function writeStorage(key, data, includeTimestamp = false) {
  try {
    const payload = includeTimestamp ? { timestamp: Date.now(), data } : data;
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.warn(`Storage write failed (${key})`, e);
  }
}

// ===============================
// GraphQL Fetcher
// ===============================
async function fetchGraphQL(query) {
  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    return json.data || {};
  } catch (err) {
    console.error("GraphQL fetch error:", err);
    return {};
  }
}

// ===============================
// Vote Event Transformation with party cleaning & fuzzy matching
// ===============================
function transformVoteEvents(rawEvents, orgNames) {
  if (!Array.isArray(rawEvents)) return [];

  return rawEvents.map((ev) => {
    const start_date = ev.start_date?.slice(0, 10) || null;
    const dt = start_date ? new Date(start_date) : null;
    const year = dt?.getUTCFullYear() || null;
    const month = dt ? dt.getUTCMonth() + 1 : null;

    const votes = Array.isArray(ev.votes)
      ? ev.votes.map((v) => {
          const originalParty = v.voter_party ?? "อื่นๆ";
          const cleanedParty = cleanText(originalParty);
          const canonicalParty = toCanonical(cleanedParty, orgNames);
          return {
            voter_name: v.voter_name ?? "__UNKNOWN__",
            voter_party: canonicalParty,   // Replace old party with cleaned + canonical
            option_en: v.option_en ?? "",
          };
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
// Public: Fetch Vote Data with integrated cleaning
// ===============================
export async function fetchVoteData() {
  // 1️⃣ Try cache first
  const cached = readStorage(CACHE_KEY, true);
  if (cached) {
    console.log("✅ Loaded vote data from cache");
    return cached;
  }

  // 2️⃣ Fetch live data + orgs for canonical list
  console.log("🌐 Fetching vote data and organizations from GraphQL...");
  const [{ voteEvents = [] }, organizations = []] = await Promise.all([
    fetchGraphQL(QUERY_VOTE_EVENTS),
    fetchOrganizations(),
  ]);

  if (!voteEvents.length) {
    console.warn("⚠️ Using staging data fallback...");
    const staging = readStorage(STAGING_KEY);
    if (staging) return staging;
    throw new Error("No staging data available and API fetch failed.");
  }

  // Prepare canonical list with special case
  const canonicalList = organizations.map((o) => o.name);
  canonicalList.push("สมาชิกวุฒิสภา");

  // 3️⃣ Transform + Save
  const records = transformVoteEvents(voteEvents, canonicalList);
  writeStorage(CACHE_KEY, records, true);
  writeStorage(STAGING_KEY, records);
  console.log("✅ Data fetched and saved to cache + staging");

  return records;
}

// ===============================
// Public: Force Refresh
// ===============================
export async function forceRefreshVoteData() {
  console.log("🔄 Forcing refresh from GraphQL...");
  const { voteEvents = [] } = await fetchGraphQL(QUERY_VOTE_EVENTS);
  if (!voteEvents.length) {
    console.warn("❌ GraphQL returned no data, keeping old staging.");
    return null;
  }

  // Fetch organizations for canonical
  const organizations = await fetchOrganizations();
  const canonicalList = organizations.map((o) => o.name);
  canonicalList.push("สมาชิกวุฒิสภา");

  const records = transformVoteEvents(voteEvents, canonicalList);
  writeStorage(CACHE_KEY, records, true);
  writeStorage(STAGING_KEY, records);
  console.log("✅ Data refreshed and stored to cache + staging");

  return records;
}

// ===============================
// Hierarchy Builder for Absence
// ===============================
export function buildAbsenceHierarchy(records) {
  const titlesPerYear = new Map();
  const nested = {};

  for (const r of records) {
    if (!r.year) continue;
    titlesPerYear.set(r.year, (titlesPerYear.get(r.year) || 0) + 1);

    for (const v of r.votes || []) {
      const party = v.voter_party || "อื่นๆ";
      const voter = v.voter_name || "__UNKNOWN__";
      const absent = isAbsent(v.option_en) ? 1 : 0;

      nested[r.year] ??= {};
      nested[r.year][party] ??= {};
      nested[r.year][party][voter] = (nested[r.year][party][voter] || 0) + absent;
    }
  }

  const root = { name: "All Years", children: [] };

  for (const [year, parties] of Object.entries(nested).sort((a, b) => +b[0] - +a[0])) {
    const totalTitles = titlesPerYear.get(+year) || 1;
    const yearNode = { name: year, totalTitles, children: [] };

    for (const [party, voters] of Object.entries(parties)) {
      const votersArr = Object.entries(voters)
        .filter(([_, count]) => count > 0)
        .map(([voter, count]) => ({ name: voter, value: count }));

      if (votersArr.length) {
        const totalAbsent = votersArr.reduce((sum, v) => sum + v.value, 0);
        yearNode.children.push({ name: party, totalAbsent, children: votersArr });
      }
    }

    if (yearNode.children.length) root.children.push(yearNode);
  }

  return root;
}

// ===============================
// Public: Fetch Organizations with Cache
// ===============================
export async function fetchOrganizations() {
  // 1️⃣ Try cache first (with TTL)
  const cached = readStorage(ORG_CACHE_KEY, true);
  if (cached) {
    console.log("✅ Loaded organizations from cache");
    return cached;
  }

  // 2️⃣ Fetch live data
  console.log("🌐 Fetching organizations from GraphQL...");
  const { organizations = [] } = await fetchGraphQL(QUERY_ORGANIZATIONS);

  // 3️⃣ Fallback to staging if fetch fails
  if (!organizations.length) {
    console.warn("⚠️ Using staging organizations fallback...");
    const staging = readStorage(ORG_STAGING_KEY);
    if (staging) return staging;
    throw new Error("No org staging data available and API fetch failed.");
  }

  // 4️⃣ Save both cache + staging
  writeStorage(ORG_CACHE_KEY, organizations, true);
  writeStorage(ORG_STAGING_KEY, organizations);
  console.log("✅ Organizations fetched and saved to cache + staging");

  return organizations;
}

// ===============================
// Public: Get Party Colors
// ===============================
export async function getPartyColors() {
  const organizations = await fetchOrganizations();
  const colors = Object.fromEntries(
    organizations
      .filter((org) => org.name && org.color)
      .map((org) => [org.name, org.color])
  );
  colors["Other"] = "#BBBBBB";
  return colors;
}
