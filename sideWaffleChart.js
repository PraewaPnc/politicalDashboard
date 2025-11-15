export function createSideWaffleChart(containerSelector, eventBus, colorByParty, latestRecord, totalMPs = 500) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // Wrapper (Flex container: column)
  const wrapper = container
    .append("div")
    .attr("class", "side-waffle-chart-wrapper")
    .style("width", "100%")
    .style("height", "100%")
    .style("display", "flex")
    .style("flex-direction", "column");

  // 1. Header Container (Title/Subtitle)
  const headerContainer = wrapper
    .append("div")
    .attr("class", "side-waffle-header")
    .style("padding-bottom", "10px")
    .style("flex", "0 0 auto");

  headerContainer.append("div")
    .attr("class", "side-waffle-chart-title")
    .style("text-align", "left")
    .style("width", "100%")
    .style("font-size", "1.2rem")
    .style("font-weight", "800")
    .style("margin-bottom", "4px")
    .text("พรรคที่คุณเชียร์ โหวตตามที่คุณคิดรึเปล่า");

  headerContainer.append("div")
    .attr("class", "side-waffle-chart-subtitle text-body")
    .style("text-align", "left")
    .style("width", "100%")
    .style("font-size", "0.9rem")
    .style("font-weight", "600")
    .style("opacity", "0.9")
    .text("การโหวตมติแบ่งตามแต่พรรคการเมืองเพื่อดูจำนวนการลงความเห็นของแต่ละพรรค");

  // 2. SVG Container (Chart Body)
  const svgContainer = wrapper
    .append("div")
    .attr("class", "side-waffle-svg-container")
    .style("flex", "1 1 auto")
    .style("display", "flex")
    .style("justify-content", "center")
    .style("align-items", "center")
    .style("overflow", "hidden");

  const svg = svgContainer
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("display", "block");

  // 3. Legend Container
  const legendContainer = wrapper
    .append("div")
    .attr("class", "side-waffle-legend-container")
    .style("flex", "0 0 auto")
    .style("padding-top", "10px");

  // States
  let lastRecord = latestRecord || null;
  let lastCategory = lastRecord ? "agree" : null;
  let selectedParty = null;
  let shape = "square"; // square | person | bar

  function setShape(newShape) {
    if (newShape === "circle") {
      shape = "bar";
    } else {
      shape = newShape;
    }
    render();
  }

  function render() {
    svg.selectAll("*:not(defs)").remove();
    legendContainer.selectAll(".side-legend").remove();

    if (!lastRecord || !lastCategory) return;

    // Filter votes by category
    const votes = (lastRecord.votes || []).filter(v => {
      const opt = (v.option_en || "").toLowerCase();
      if (lastCategory === "agree") return opt.includes("agree");
      if (lastCategory === "disagree") return opt.includes("disagree");
      if (lastCategory === "abstain") return opt.includes("abstain");
      if (lastCategory === "novote") return opt.includes("no vote") || opt.includes("novote");
      return false;
    });

    // Group by party
    const grouped = d3.rollup(votes, v => v.length, v => v.voter_party || "Other");
    const sortedParties = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);

    let partiesToShow;
    if (shape === "square") {
      const top6 = sortedParties.slice(0, 6);
      const rest = sortedParties.slice(6);
      const otherSum = d3.sum(rest, d => d[1]);
      if (otherSum > 0) top6.push(["Other", otherSum]);
      partiesToShow = top6;
    } else {
      partiesToShow = sortedParties;
    }

    // 🟢 TOTAL votes in this category
    const total = d3.sum(partiesToShow, d => d[1]);
    if (total === 0) return;

    // ==========================
    //     WAFFLE MODE
    // ==========================
    if (shape === "square") {
      svgContainer.style("max-height", "70%");
      svg.attr("width", "100%").attr("height", "100%");

      const maxCells = 200;
      const factor = Math.max(1, Math.ceil(total / maxCells));

      const cells = [];
      partiesToShow.forEach(([party, count]) => {
        const cellCount = Math.max(1, Math.round(count / factor));
        for (let i = 0; i < cellCount; i++) cells.push(party);
      });

      const cols = 20;
      const cellSize = 10;
      const gap = 1.5;

      const rows = Math.ceil(cells.length / cols);
      const w = cols * (cellSize + gap) - gap;
      const h = rows * (cellSize + gap) - gap;

      svg.attr("viewBox", `0 0 ${w + 1} ${h + 1}`);

      const g = svg.append("g").attr("transform", `translate(0.5, 0.5)`);

      g.selectAll("rect.cell")
        .data(cells)
        .join("rect")
        .attr("x", (_, i) => (i % cols) * (cellSize + gap))
        .attr("y", (_, i) => Math.floor(i / cols) * (cellSize + gap))
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("rx", 1.5)
        .attr("fill", d => colorByParty[d] || "#bbb");

      // ⭐⭐⭐ FIXED LEGEND — Percent matches Pie Chart ⭐⭐⭐
      legendContainer
        .append("div")
        .attr("class", "side-legend text-body")
        .style("max-width", "100%")
        .style("overflow", "hidden")
        .html(() => {
          return (
            `<div class="text-body" style="font-weight:600; margin-bottom:6px;">
              ${lastCategory} — total ${total} 
              <i style="font-size:11px;"> 1ช่อง ≈ ${factor} โหวต</i>
            </div>` +
            partiesToShow
              .map(([party, count]) => {
                const color = colorByParty[party] || "#bbb";

                // ⭐ เปอร์เซ็นต์จาก category นี้เท่านั้น — MATCH PIE ⭐
                const percent = ((count / total) * 100).toFixed(1);

                return `
                  <div style="display:flex; justify-content:space-between; align-items:center; margin:3px 0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="width:12px; height:12px; background:${color}; display:inline-block;"></span>
                      <span class="text-body" style="font-size:13px;">${party}</span>
                    </div>
                    <div class="text-body-secondary" style="font-size:13px">
                      ${count} 
                    </div>
                  </div>
                `;
              })
              .join("")
          );
        });
    }

    // ==========================
    //       BAR MODE
    // ==========================
    else if (shape === "bar") {
      svgContainer.style("max-height", null);
      svg.attr("width", "100%").attr("height", "auto");

      const chartWidth = 450;
      const barHeight = 22;
      const barGap = 8;
      const margin = { top: 20, right: 40, bottom: 20, left: 110 };

      const barCount = partiesToShow.length;
      const svgHeight = margin.top + margin.bottom + barCount * (barHeight + barGap);

      svg.attr("viewBox", `0 0 ${chartWidth} ${svgHeight}`).attr("height", svgHeight);

      const g = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

      const maxValue = d3.max(partiesToShow, d => d[1]);

      const x = d3.scaleLinear()
        .domain([0, maxValue])
        .range([0, chartWidth - margin.left - margin.right]);

      g.selectAll("text.party")
        .data(partiesToShow)
        .join("text")
        .attr("class", "party")
        .attr("x", -10)
        .attr("y", (_, i) => i * (barHeight + barGap) + barHeight / 1.3)
        .attr("text-anchor", "end")
        .style("font-size", "12px")
        .text(d => d[0]);

      g.selectAll("rect.bar")
        .data(partiesToShow)
        .join("rect")
        .attr("x", 0)
        .attr("y", (_, i) => i * (barHeight + barGap))
        .attr("width", d => x(d[1]))
        .attr("height", barHeight)
        .attr("fill", d => colorByParty[d[0]] || "#bbb");

      g.selectAll("text.value")
        .data(partiesToShow)
        .join("text")
        .attr("class", "value")
        .attr("x", d => x(d[1]) + 4)
        .attr("y", (_, i) => i * (barHeight + barGap) + barHeight / 1.3)
        .style("font-size", "11px")
        .text(d => d[1]);
    }
  }

  // Event listeners
  eventBus.on("waffle:selected", rec => {
    lastRecord = rec;
    render();
  });

  eventBus.on("pie:categorySelected", cat => {
    lastCategory = cat;
    render();
  });

  eventBus.on("party:filterChanged", p => {
    selectedParty = p === "all" ? null : p;
    render();
  });

  if (lastRecord) render();

  return { setShape, render };
}
