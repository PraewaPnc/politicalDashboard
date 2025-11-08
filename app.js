// app.js
import { fetchVoteData, forceRefreshVoteData, getPartyColors } from "./data.js";
import { createWaffleChart } from "./waffleChart.js";
import { createPieChart } from "./pieChart.js";
import { createSideWaffleChart } from "./sideWaffleChart.js";
import { createIcicleChart } from "./icicleChart.js";
import { createDetailsPopup } from "./popup.js";

let allRecords = [];
let PARTY_COLORS = {};
let currentYear = null;
let currentParty = null;
let pieChartInstance = null;
let sideWaffleChartInstance = null;

/* ---------------- EventBus ---------------- */
class EventBus {
  constructor() { this.handlers = {}; }
  on(event, fn) { (this.handlers[event] ||= []).push(fn); }
  dispatch(event, payload) { (this.handlers[event] || []).forEach(fn => fn(payload)); }
}
const bus = new EventBus();

/* ---------------- INIT ---------------- */
async function init() {
  // NEW: Theme initialization must run early to set the theme before charts render
  setupThemeToggle(); 
  
  await loadData();
  setupFilters();
  setupRefreshButton();
  setupTooltipAndTreemap();
  setupShapeToggle();
  createDetailsPopup("#popupContainer", bus);
}

// ... (loadData, setupFilters, populateYearFilter, populatePartyFilter, setupRefreshButton functions)

/* ---------------- THEME TOGGLE (NEW FUNCTION) ---------------- */
function setupThemeToggle() {
  const htmlElement = document.documentElement;
  const switchElement = document.getElementById('darkModeSwitch');
  const labelElement = document.getElementById('mode-label');
  const localStorageKey = 'themePreference';

  // Function to determine the theme (Priority: Saved > System > Default)
  function getPreferredTheme() {
    // 1. Check for saved preference
    const savedTheme = localStorage.getItem(localStorageKey);
    if (savedTheme) {
      return savedTheme;
    }
    // 2. Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  
  function applyTheme(theme) {
    htmlElement.setAttribute('data-bs-theme', theme);
    switchElement.checked = theme === 'dark';
    labelElement.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    // You might want to dispatch an event here if other components need to know the theme changed
    // bus.dispatch('theme:changed', theme); 
  }

  // Set initial theme
  applyTheme(getPreferredTheme());

  // --- Event Listener for Toggle ---
  switchElement.addEventListener('change', function () {
    const newTheme = this.checked ? 'dark' : 'light';
    
    // Apply and save the new theme
    applyTheme(newTheme);
    localStorage.setItem(localStorageKey, newTheme);
  });
  
  // --- Listen for System Theme Changes ---
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only auto-update if the user hasn't explicitly set a preference
    if (!localStorage.getItem(localStorageKey)) {
        applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

/* ---------------- LOAD DATA ---------------- */
async function loadData(force = false) {
  const loader = document.getElementById("status");
  if (loader) loader.textContent = force ? "Refreshing data..." : "Loading data...";

  try {
    allRecords = force ? await forceRefreshVoteData() : await fetchVoteData();
    PARTY_COLORS = await getPartyColors();

    if (!allRecords?.length) {
      throw new Error("No records loaded");
    }

    if (loader) loader.textContent = `✅ Loaded all records`; 
    populateYearFilter();
    populatePartyFilter();
    renderAll();
  } catch (err) {
    console.error("Failed to load data:", err);
    if (loader) loader.textContent = "❌ Failed to load data (using cached/staging if available)";
  }
}

/* ---------------- FILTERS ---------------- */
function setupFilters() {
  const yearSel = d3.select("#yearFilter");
  const partySel = d3.select("#partyFilter");

  yearSel.on("change", e => {
    currentYear = +e.target.value || null;
    renderAll();
    bus.dispatch("year:filterChanged", currentYear);
  });

  partySel.on("change", e => {
    currentParty = e.target.value === "all" ? null : e.target.value;
    bus.dispatch("party:filterChanged", currentParty);
    sideWaffleChartInstance?.render?.();
  });
}

function populateYearFilter() {
  const yearSel = d3.select("#yearFilter");
  const years = [...new Set(allRecords.map(d => d.year))].filter(Boolean).sort((a, b) => a - b);

  yearSel.selectAll("option").remove();

  if (years.length === 0) {
    yearSel.append("option").attr("value", "").text("No data");
    return;
  }

  yearSel.selectAll("option")
    .data(years)
    .join("option")
    .attr("value", d => d)
    .text(d => d);

  currentYear = years.at(-1);
  yearSel.property("value", currentYear);
}

function populatePartyFilter() {
  const partySel = d3.select("#partyFilter");
  const parties = [...new Set(allRecords.flatMap(r => (r.votes || []).map(v => v.voter_party)))].filter(Boolean).sort();

  partySel.selectAll("option")
    .data(["all", ...parties])
    .join("option")
    .attr("value", d => d)
    .text(d => d);
}

/* ---------------- REFRESH BUTTON ---------------- */
function setupRefreshButton() {
  const refreshBtn = document.getElementById("refreshData");
  const status = document.getElementById("status");
  if (!refreshBtn) return;

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    const originalText = refreshBtn.textContent;
    refreshBtn.textContent = "🔄 Refreshing...";
    if (status) status.textContent = "Fetching latest data...";

    try {
      await loadData(true);
      if (status) status.textContent = "✅ Data refreshed successfully";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "❌ Refresh failed (using old data)";
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = originalText;
    }
  });
}

/* ---------------- TOOLTIP + TREEMAP ---------------- */
function setupTooltipAndTreemap() {
  const tooltip = d3.select("#tooltip");

  bus.on("tooltip:show", ({ event, record }) => {
    tooltip.classed("hidden", false);
    tooltip.select("#tooltip-header").text(new Date(record.dateStr).toLocaleDateString());
    tooltip.select("#tooltip-sub").text(record.title);
    tooltip.select("#tooltip-percent").text(`Present: ${record.presentCount}/${record.totalVoters} (${record.presentPercent}%)`);
    bus.dispatch("show:treemap", record);
    moveTooltip(event);
  });

  bus.on("tooltip:move", ({ event }) => moveTooltip(event));
  bus.on("tooltip:hide", () => tooltip.classed("hidden", true));

  function moveTooltip(event) {
    if (!event) return;
    const offset = 12;
    tooltip.style("left", `${Math.min(window.innerWidth - 10, event.clientX + offset)}px`)
      .style("top", `${Math.min(window.innerHeight - 10, event.clientY + offset)}px`);
  }

  bus.on("show:treemap", (record) => renderTreemap(record, tooltip));
}

function renderTreemap(record, tooltip) {
  const svg = d3.select("#tooltip-treemap");
  svg.selectAll("*").remove();

  const partyBreakdown = record.partyBreakdown || {};
  const entries = Object.entries(partyBreakdown).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 9);
  const other = entries.slice(9).reduce((sum, [, v]) => sum + v, 0);
  const nodes = top.map(([k, v]) => ({ party: k, value: v }));
  if (other > 0) nodes.push({ party: "Other", value: other });

  if (!nodes.length) {
    svg.append("text").attr("x", 180).attr("y", 120)
      .attr("text-anchor", "middle").text("No present voters");
    return;
  }

  const w = +svg.attr("width"), h = +svg.attr("height");
  const root = d3.hierarchy({ children: nodes }).sum(d => d.value);
  d3.treemap().size([w, h]).paddingInner(4)(root);

  const color = d3.scaleOrdinal()
    .domain(nodes.map(n => n.party))
    .range(nodes.map(n => PARTY_COLORS[n.party] || PARTY_COLORS["Other"]));

  const g = svg.selectAll("g.node")
    .data(root.leaves())
    .join("g")
    .attr("transform", d => `translate(${d.x0},${d.y0})`);

  g.append("rect")
    .attr("width", d => d.x1 - d.x0)
    .attr("height", d => d.y1 - d.y0)
    .attr("fill", d => color(d.data.party))
    .attr("stroke", d => currentParty === d.data.party ? "#000" : "none")
    .attr("stroke-width", d => currentParty === d.data.party ? 3 : 1)
    .attr("opacity", d => (!currentParty || d.data.party === currentParty) ? 1 : 0.4);

  g.append("text")
    .attr("x", 6).attr("y", 14).attr("font-size", 12).attr("fill", d => {
      const c = d3.color(color(d.data.party));
      // fallback when d.data.party is Other (color might be set to gray)
      const hex = c ? c.formatHex() : "#999";
      const cc = d3.color(hex);
      const lum = 0.2126*cc.r + 0.7152*cc.g + 0.0722*cc.b;
      return lum < 140 ? "#fff" : "#111"; // use white text on dark bg
    })
    .text(d => `${d.data.party}: ${d.data.value}`)
    .each(function (d) {
      const w = d.x1 - d.x0, h = d.y1 - d.y0;
      if (w < 80 || h < 18) d3.select(this).style("display", "none");
    });

  const legend = d3.select("#tooltip-legend").html("");
  nodes.forEach(n => {
    legend.append("div").attr("class", "legend-row")
      .style("opacity", !currentParty || currentParty === n.party ? 1 : 0.4)
      .html(`
        <div style="display:flex;align-items:center">
          <span style="width:10px;height:10px;background:${color(n.party)};margin-right:8px;border-radius:2px;display:inline-block"></span>
          ${n.party}
          <span style="margin-left:auto">${n.value}</span>
        </div>
        
      `);
  });
}

/* ---------------- SHAPE TOGGLE ---------------- */
function setupShapeToggle() {
  const squareBtn = document.getElementById("shapeSquare");
  const personBtn = document.getElementById("shapePerson");

  if (!squareBtn || !personBtn) return;

  // Default
  if (!squareBtn.classList.contains("active") && !personBtn.classList.contains("active")) {
    squareBtn.classList.add("active");
  }

  squareBtn.addEventListener("click", () => {
    squareBtn.classList.add("active");
    personBtn.classList.remove("active");
    renderAll();
  });

  personBtn.addEventListener("click", () => {
    personBtn.classList.add("active");
    squareBtn.classList.remove("active");
    renderAll();
  });
}

/* ---------------- RENDER ALL ---------------- */
function renderAll() {
  const filtered = allRecords.filter(r => r.year === currentYear);
  if (!filtered.length) return console.warn("No data for selected year:", currentYear);
  
  // 1. CALL WAFFLE CHART (FIXED: Removed duplicate call)
  const waffleResult = createWaffleChart("#waffleChart", filtered, bus);
  const latestRecord = waffleResult.latestRecord;
  
  // 2. CALL PIE CHART 
  if (!pieChartInstance) {
    pieChartInstance = createPieChart("#pieChart", bus, latestRecord);
  } else {
    pieChartInstance.update(latestRecord);
  }

  // 3. SIDE WAFFLE CHART
  if (!sideWaffleChartInstance)
    sideWaffleChartInstance = createSideWaffleChart("#sideWaffleChart", bus, PARTY_COLORS, latestRecord);
  else {
    bus.dispatch("waffle:selected", latestRecord);
  }
  const squareActive = document.getElementById("shapeSquare")?.classList.contains("active");
  sideWaffleChartInstance?.setShape?.(squareActive ? "square" : "person");

  createIcicleChart("#icicleChart", allRecords, PARTY_COLORS, bus);
  bus.dispatch("year:filterChanged", currentYear);
}

/* ---------------- START ---------------- */
init();