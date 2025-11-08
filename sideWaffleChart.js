// sideWaffleChart.js
// Uses inline <symbol id="personIcon"> and <use> with CSS 'color' for party color

export function createSideWaffleChart(containerSelector, eventBus, colorByParty, latestRecord) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // --- NEW: Add Chart Title ---
  container.append("div")
    .attr("class", "side-waffle-chart-title text-body")
    .style("text-align", "left")
    .style("font-size", "1.2rem") // h4 size
    .style("font-weight", "bold")
    .style("margin-bottom", "10px")
    .text("Party Breakdown by Vote Category");
  // ---------------------------

  // Create SVG and defs for person icon (uses currentColor)
  const svg = container
    .append("svg")
    .attr("width", "100%")
    .attr("height", 220)
    .attr("viewBox", "0 0 240 240");

  const defs = svg.append("defs");
  defs
    .append("symbol")
    .attr("id", "personIcon")
    .attr("viewBox", "0 0 64 64")
    .append("g")
    .html(`
      <circle cx="32" cy="16" r="12" fill="currentColor"></circle>
      <path d="M8 56c0-13 11-24 24-24s24 11 24 24" fill="currentColor"></path>
    `);

  // Internal state
  let lastRecord = latestRecord || null; 
  let lastCategory = lastRecord ? "agree" : null; 
  let selectedParty = null;
  let shape = "square"; // or "person"

  // Setter for shape type and trigger render
  function setShape(newShape) {
    shape = newShape;
    render();
  }

  function render() {
    // Clear previous chart elements except defs
    svg.selectAll("*:not(defs)").remove();
    // Remove old legend
    d3.select(containerSelector).selectAll(".side-legend").remove();

    if (!lastRecord || !lastCategory) return;

    // Filter votes by category (case-insensitive)
    const votes = (lastRecord.votes || []).filter(v => {
      const opt = (v.option_en || "").toLowerCase();
      if (lastCategory === "agree") return opt.includes("agree");
      if (lastCategory === "disagree") return opt.includes("disagree");
      if (lastCategory === "abstain") return opt.includes("abstain");
      if (lastCategory === "novote" || lastCategory === "no vote") {
        return opt.includes("novote") || opt.includes("no vote");
      }
      return false;
    });

    // Group votes count by party
    const grouped = d3.rollup(votes, v => v.length, v => v.voter_party || "Other");
    const sortedParties = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);

    // Top 6 parties + "Other"
    const top = sortedParties.slice(0, 6);
    const rest = sortedParties.slice(6);
    const otherSum = d3.sum(rest, d => d[1]);
    if (otherSum > 0) top.push(["Other", otherSum]);

    const total = d3.sum(top, d => d[1]);
    if (total === 0) return;

    // Create scaled array of cells (max ~200)
    const maxCells = 200;
    const factor = Math.max(1, Math.ceil(total / maxCells));
    const cells = [];
    top.forEach(([party, count]) => {
      const cellCount = Math.max(1, Math.round(count / factor));
      for (let i = 0; i < cellCount; i++) cells.push(party);
    });

    // Layout params
    const cols = 15;
    const cellSize = 15;
    const gap = 2;
    const width = cols * (cellSize + gap);
    const rows = Math.ceil(cells.length / cols);

    const g = svg.append("g").attr("transform", `translate(10,10)`);

    if (shape === "square") {
      g.selectAll("rect.cell")
        .data(cells)
        .join("rect")
        .attr("class", "side-square")
        .attr("x", (_, i) => (i % cols) * (cellSize + gap))
        .attr("y", (_, i) => Math.floor(i / cols) * (cellSize + gap))
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("fill", d =>
          selectedParty && d !== selectedParty ? "#dcdcdc" : colorByParty[d] || "#bbb"
        )
        .classed("dim", d => selectedParty && d !== selectedParty)
        .classed("highlight", d => selectedParty && d === selectedParty);
    } else {
      // Person icons, use <use> with color styling
      const group = g
        .selectAll("g.person")
        .data(cells)
        .join("g")
        .attr(
          "transform",
          (_, i) => `translate(${(i % cols) * (cellSize + gap)},${Math.floor(i / cols) * (cellSize + gap)})`
        );

      group
        .append("use")
        .attr("href", "#personIcon")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", cellSize)
        .attr("height", cellSize)
        .style("color", d =>
          selectedParty && d !== selectedParty ? "#dcdcdc" : colorByParty[d] || "#bbb"
        )
        .classed("dim", d => selectedParty && d !== selectedParty)
        .classed("highlight", d => selectedParty && d === selectedParty);
    }

    // Legend
    const legend = d3
      .select(containerSelector)
      .selectAll(".side-legend")
      .data([1])
      .join("div")
      .attr("class", "side-legend text-body") // Added text-body for color switching
      .style("margin-top", "8px")
      .html(() => {
        return (
          // Adjusted legend header for dark mode
          `<div class="text-body" style="font-weight:600; margin-bottom:6px;">${lastCategory} — total ${total}</div>` +
          top
            .map(([party, count]) => {
              const color = colorByParty[party] || "#bbb";
              const dimStyle = selectedParty && party !== selectedParty ? "opacity:0.35" : "";
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin:3px 0;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:12px; height:12px; background:${color}; display:inline-block;"></span>
                    <span class="text-body" style="font-size:15px;">${party}</span>
                  </div>
                  <div class="text-body-secondary" style="${dimStyle}; font-size:15px">${count}</div>
                </div>
              `;
            })
            .join("")
        );
      });
  }

  // Event handlers
  eventBus.on("waffle:selected", rec => {
    lastRecord = rec;
    lastCategory = lastCategory || "agree"; // If a new record is selected, default to 'agree' if no category was set
    render();
  });

  eventBus.on("pie:categorySelected", cat => {
    lastCategory = cat;
    render();
  });

  eventBus.on("party:filterChanged", p => {
    selectedParty = p === "all" || !p ? null : p;
    render();
  });

  // Call render immediately to display the latest record on load
  if (lastRecord) render(); 

  // Public API
  return { setShape, render };
}