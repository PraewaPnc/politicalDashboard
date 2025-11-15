// data.js

// ===============================
// Constants (Unchanged)
// ===============================
const GRAPHQL_ENDPOINT = "https://politigraph.wevis.info/graphql";

const CACHE_KEY = "voteDataCache_v1";
const STAGING_KEY = "voteDataStaging_v1";

const ORG_CACHE_KEY = "orgCache_v1";
const ORG_STAGING_KEY = "orgStaging_v1";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h


// ===============================
// Base Path Fix for GitHub Pages + Mobile
// ===============================
const basePath =
  window.location.origin +
  window.location.pathname.replace(/\/[^\/]*$/, "/");


// ===============================
// GraphQL Queries (Unchanged)
// ... (ส่วนนี้ไม่เปลี่ยนแปลง)
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
// Utility Functions (Adjusted fetchFileStaging)
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

async function fetchCleanedPartyMap() {
  try {
    const res = await fetch(`${basePath}cleaned_party_map.json`);
    if (!res.ok) throw new Error("Failed to load cleaned party map.");
    return await res.json();
  } catch (err) {
    console.error("Failed to load party cleaning map (Defaulting to original parties):", err);
    return {};
  }
}

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

/**
 * ฟังก์ชันที่ถูกปรับปรุงให้ยืดหยุ่นในการรับ filePath มากขึ้น
 * โดยการลบเครื่องหมาย / หรือ ./ ที่นำหน้า filePath ออก
 */
async function fetchFileStaging(filePath) {
  try {
    // แก้ไข: ลบเครื่องหมาย / ที่ขึ้นต้น และ ./ ที่ขึ้นต้น
    const clean = filePath.replace(/^\/+|\.\//g, "");
    
    // basePath จะมี / ปิดท้ายเสมอ ดังนั้น clean ที่ไม่มี / นำหน้าจะทำให้ URL ถูกต้อง
    const fullPath = `${basePath}${clean}`;
    const res = await fetch(fullPath);

    if (!res.ok) throw new Error(`Staging file not found or inaccessible at: ${fullPath}`);
    const obj = await res.json();
    return obj.data; 
  } catch (e) {
    console.warn(`Could not fetch file staging (${filePath}):`, e.message);
    return null;
  }
}

async function fetchWithTimeout(resource, options = {}, timeout = 30000) {
// ... (ส่วนนี้ไม่เปลี่ยนแปลง)
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal  
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function fetchGraphQLWithTimeout(query, timeout = 30000) {
// ... (ส่วนนี้ไม่เปลี่ยนแปลง)
  try {
    const res = await fetchWithTimeout(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }, timeout);

    const json = await res.json();
    return json.data || {};
  } catch (err) {
    console.warn("GraphQL fetch timeout or error:", err);
    return {};
  }
}

function transformVoteEvents(rawEvents, cleanedPartyMap = {}) {
// ... (ส่วนนี้ไม่เปลี่ยนแปลง)
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
          const cleaned_party = cleanedPartyMap[voteId] || original_party;

          return {
            id: voteId,
            voter_name: v.voter_name ?? "__UNKNOWN__",
            voter_party: cleaned_party ?? "อื่นๆ",
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

export async function fetchVoteData(onStatusUpdate) {
  const cached = readStorage(CACHE_KEY, true);
  if (cached) {
    console.log("✅ Loaded vote data from client cache");
    onStatusUpdate?.("Loaded data from cache");
    return cached;
  }

  console.log("🌐 Fetching vote data from GraphQL with 30s timeout...");
  onStatusUpdate?.("Fetching fresh data from server...");
  const { voteEvents = [] } = await fetchGraphQLWithTimeout(QUERY_VOTE_EVENTS, 30000);
  
  console.log("Fetching cleaned party name map...");
  onStatusUpdate?.("Fetching cleaned party map...");
  const cleanedPartyMap = await fetchCleanedPartyMap();

  if (!voteEvents.length) {
    console.warn("⚠️ GraphQL fetch failed or timed out. Loading from server file staging...");
    onStatusUpdate?.("Fetch failed, loading from server staging file...");
    
    // ไม่ต้องลบ / ที่นำหน้าแล้ว เพราะ fetchFileStaging จัดการให้
    const fileStaging = await fetchFileStaging('data_cache/vote_data_cache.json'); 

    if (fileStaging) {
      console.log("✅ Loaded vote data from server file staging.");
      onStatusUpdate?.("Loaded data from server staging file");
      writeStorage(CACHE_KEY, fileStaging, true);
      return fileStaging;
    }

    const staging = readStorage(STAGING_KEY);
    if (staging) {
      console.log("✅ Loaded vote data from localStorage staging.");
      onStatusUpdate?.("Loaded data from localStorage staging");
      return staging;
    }

    throw new Error("No staging data available and API fetch failed or timed out.");
  }

  const records = transformVoteEvents(voteEvents, cleanedPartyMap);
  writeStorage(CACHE_KEY, records, true);
  writeStorage(STAGING_KEY, records);
  console.log("✅ Data fetched, processed, and saved to client cache + staging");
  onStatusUpdate?.("Loaded fresh data from server");

  return records;
}

export async function forceRefreshVoteData(onStatusUpdate) {
  console.log("🔄 Forcing refresh from GraphQL...");
  onStatusUpdate?.("Forcing refresh from server...");
  const { voteEvents = [] } = await fetchGraphQLWithTimeout(QUERY_VOTE_EVENTS, 30000);
  if (!voteEvents.length) {
    console.warn("❌ GraphQL returned no data, using file staging fallback.");
    onStatusUpdate?.("Refresh failed, loading from server staging file...");
    
    // ไม่ต้องลบ / ที่นำหน้าแล้ว เพราะ fetchFileStaging จัดการให้
    const fileStaging = await fetchFileStaging('data_cache/vote_data_cache.json'); 
    return fileStaging;
  }
  
  const cleanedPartyMap = await fetchCleanedPartyMap();

  const records = transformVoteEvents(voteEvents, cleanedPartyMap);
  writeStorage(CACHE_KEY, records, true);
  writeStorage(STAGING_KEY, records);
  console.log("✅ Data refreshed and stored to client cache + staging");
  onStatusUpdate?.("Refresh succeeded with fresh data");

  return records;
}



// ===============================
// Hierarchy Builder for Absence (Unchanged)
// ... (ส่วนนี้ไม่เปลี่ยนแปลง)
// ===============================
export function buildAbsenceHierarchy(records) {
  const titlesPerYear = new Map();
  const nested = {};

  for (const r of records) {
    if (!r.year) continue;
    titlesPerYear.set(r.year, (titlesPerYear.get(r.year) || 0) + 1);

    for (const v of r.votes || []) {
      const party = v.voter_party || "อื่นๆ"; // This will be the CLEANED party name
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
// Public: Organizations with Cache (Adjusted fetchFileStaging call)
// ===============================
export async function fetchOrganizations() {
  // 1️⃣ Try cache first (with TTL)
  const cached = readStorage(ORG_CACHE_KEY, true);
  if (cached) {
    console.log("✅ Loaded organizations from client cache");
    return cached;
  }

  // 2️⃣ Fetch live data
  console.log("🌐 Fetching organizations from GraphQL...");
  // ต้องมีการเรียกใช้ fetchGraphQL ให้ถูกต้อง (เดิมในโค้ดที่ให้มามีการเรียกใช้ fetchGraphQL โดยไม่มี Timeout)
  // ให้สมมติว่าคุณมีฟังก์ชัน fetchGraphQL หรือใช้ fetchGraphQLWithTimeout ไปเลย
  const { organizations = [] } = await fetchGraphQLWithTimeout(QUERY_ORGANIZATIONS, 30000); 

  // 3️⃣ Fallback to staging if fetch fails
  if (!organizations.length) {
    console.warn("⚠️ Using staging organizations fallback...");
    
    // Check server file staging first (assuming the Node.js pipeline runs for orgs too)
    // ไม่ต้องลบ / ที่นำหน้าแล้ว เพราะ fetchFileStaging จัดการให้
    const fileStaging = await fetchFileStaging('data_cache/organizations_cache.json'); 
    
    if (fileStaging) {
        console.log("✅ Loaded organizations from server file staging.");
        return fileStaging;
    }

    // Fallback to localStorage staging
    const staging = readStorage(ORG_STAGING_KEY);
    if (staging) return staging;
    
    throw new Error("No org staging data available and API fetch failed.");
  }

  // 4️⃣ Save both cache + staging
  writeStorage(ORG_CACHE_KEY, organizations, true);
  writeStorage(ORG_STAGING_KEY, organizations);
  console.log("✅ Organizations fetched and saved to client cache + staging");

  return organizations;
}

export async function getPartyColors() {
// ... (ส่วนนี้ไม่เปลี่ยนแปลง)
  const organizations = await fetchOrganizations();
  
  const colors = Object.fromEntries(
    organizations
      .filter((org) => org.name && org.color)
      .map((org) => {
        let name = org.name.trim();
  
        // ✅ add prefix “พรรค” if not already there
        if (!name.startsWith("พรรค") && name !== "สมาชิกวุฒิสภา" && name !== "อื่นๆ") {
          name = "พรรค" + name;
        }
  
        return [name, org.color];
      })
  );
  
  colors["Other"] = "#BBBBBB";
  colors["อื่นๆ"] = "#BBBBBB"; // ✅ also cover Thai “อื่นๆ”
  return colors;
}