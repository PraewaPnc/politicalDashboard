// sideWaffleChart.js

export function createSideWaffleChart(containerSelector, eventBus, colorByParty, latestRecord, totalMPs = 700) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // --- Container Wrapper ---
  const wrapper = container
    .append("div")
    .attr("class", "side-waffle-chart-wrapper")
    .style("width", "100%")
    .style("height", "100%")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("justify-content", "space-between"); // ✅ แทน flex-start

  // --- Chart Body (title + svg) ---
  const chartBody = wrapper
    .append("div")
    .attr("class", "side-waffle-chart-body")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("align-items", "center")
    .style("flex", "1 1 auto")
    .style("overflow", "hidden");

  // --- Chart Title ---
  chartBody
    .append("div")
    .attr("class", "side-waffle-chart-title text-body")
    .style("text-align", "left")
    .style("width", "100%")
    .style("font-size", "1.2rem")
    .style("font-weight", "bold")
    .style("margin-bottom", "4px")
    .text("การโหวตแบ่งตามพรรคการเมือง");

  // --- SVG base ---
  const svg = chartBody
    .append("svg")
    .attr("width", "100%")
    .attr("height", "auto")
    .attr("viewBox", "0 0 240 240")
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("overflow", "hidden")
    .style("display", "block");


  // --- Internal state ---
  let lastRecord = latestRecord || null;
  let lastCategory = lastRecord ? "agree" : null;
  let selectedParty = null;
  let shape = "square"; //

  // --- Setter for shape ---
  function setShape(newShape) {
    shape = newShape;
    render();
  }

  // --- Render function ---
  function render() {
    // เคลียร์กราฟเก่า (เว้น defs)
    svg.selectAll("*:not(defs)").remove();
    wrapper.selectAll(".side-legend").remove();

    if (!lastRecord || !lastCategory) return;

    // กรองข้อมูลตาม category
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

    // รวมจำนวนตามพรรค
    const grouped = d3.rollup(votes, v => v.length, v => v.voter_party || "Other");
    const sortedParties = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
    const top = sortedParties.slice(0, 6);
    const rest = sortedParties.slice(6);
    const otherSum = d3.sum(rest, d => d[1]);
    if (otherSum > 0) top.push(["Other", otherSum]);

    const total = d3.sum(top, d => d[1]);
    if (total === 0) return;

    // --- สร้าง cells ---
    const maxCells = 200;
    const factor = Math.max(1, Math.ceil(total / maxCells));
    const cells = [];
    top.forEach(([party, count]) => {
      const cellCount = Math.max(1, Math.round(count / factor));
      for (let i = 0; i < cellCount; i++) cells.push(party);
    });

    // --- Layout parameters ---
    const cols = 20;
    const cellSize = 10;
    const gap = 1.5;
    const width = cols * (cellSize + gap);
    const rows = Math.ceil(cells.length / cols);
    const height = rows * (cellSize + gap);

    // ✅ ปรับ viewBox ตามจำนวน cell
    svg
      .attr("viewBox", `0 0 ${width + 20} ${height + 20}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g").attr("transform", "translate(10,10)");

    // --- วาด cells ---
    if (shape === "square") {
      g.selectAll("rect.cell")
        .data(cells)
        .join("rect")
        .attr("x", (_, i) => (i % cols) * (cellSize + gap))
        .attr("y", (_, i) => Math.floor(i / cols) * (cellSize + gap))
        .attr("width", cellSize)
        .attr("height", cellSize)
        .attr("rx", 1.5)
        .attr("fill", d =>
          selectedParty && d !== selectedParty ? "#dcdcdc" : colorByParty[d] || "#bbb"
        )
        .classed("dim", d => selectedParty && d !== selectedParty)
        .classed("highlight", d => selectedParty && d === selectedParty);
} else {
  // ✅ ใช้ factor ที่คำนวณไว้แล้ว (ไม่สร้าง legend ใหม่)
  const svgSize = 240;
  const chartHeight = 200;

  svg
    .attr("height", chartHeight + 40)
    .attr("viewBox", `0 0 ${svgSize} ${chartHeight + 40}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${svgSize / 2}, ${chartHeight * 0.9})`);


  // ✅ เรียง top พรรคจากมากไปน้อย
  const sortedTop = [...top].sort((a, b) => b[1] - a[1]);

  // ✅ ใช้ factor ที่มีอยู่แล้ว -> 1 จุดแทนกี่โหวต
  const circlesData = [];
  sortedTop.forEach(([party, count]) => {
    const reducedCount = Math.max(1, Math.round(count / factor));
    for (let i = 0; i < reducedCount; i++) {
      circlesData.push({ voter_party: party });
    }
  });

  // ✅ ควบคุมจำนวน layer & สัดส่วนให้คงรูปสวย
  const totalSeats = circlesData.length;
  const maxSeats = 200;
  const scaleFactor = Math.sqrt(totalSeats / maxSeats);

  const layers = Math.max(5, Math.round(5 * scaleFactor));
  const basePoints = Math.round(24 * scaleFactor);
  const radiusStart = 55;
  const radiusStep = 16;
  const angleStart = Math.PI;
  const angleEnd = 0;

  let index = 0;
  const positions = [];

  for (let r = 0; r < layers; r++) {
    const radius = radiusStart + r * radiusStep;
    const n = Math.round(basePoints * (radius / radiusStart) * 0.8);
    const angleStep = (angleEnd - angleStart) / (n - 1);

    for (let i = 0; i < n; i++) {
      if (index >= circlesData.length) break;
      const angle = angleStart + i * angleStep;
      positions.push({
        ...circlesData[index],
        x: Math.cos(angle) * radius,
        y: -Math.sin(angle) * radius,
      });
      index++;
    }
  }

  // ✅ วาดวงกลม
  const circles = g
    .selectAll("circle.cell")
    .data(positions)
    .join("circle")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", 4.5)
    .attr("fill", d =>
      selectedParty && d.voter_party !== selectedParty
        ? "#dcdcdc"
        : colorByParty[d.voter_party] || "#bbb"
    )
    .style("transition", "fill 0.15s ease-out");

  // ✅ Tooltip
  circles
    .on("mouseover", function (event, d) {
      d3.select(this).attr("stroke", "#000").attr("stroke-width", 1.3);
      const tooltip = d3.select("body")
        .append("div")
        .attr("class", "tooltip")
        .style("position", "absolute")
        .style("padding", "4px 8px")
        .style("background", "#333")
        .style("color", "#fff")
        .style("border-radius", "4px")
        .style("font-size", "12px")
        .style("pointer-events", "none")
        .style("opacity", 0)
        .style("z-index", 1000)
        .text(d.voter_party || "Unknown");

      tooltip.transition().duration(60).style("opacity", 0.95);
      tooltip
        .style("left", `${event.pageX + 5}px`)
        .style("top", `${event.pageY - 10}px`);
    })
    .on("mousemove", function (event) {
      d3.select("body").select(".tooltip")
        .style("left", `${event.pageX + 5}px`)
        .style("top", `${event.pageY - 10}px`);
    })
    .on("mouseout", function () {
      d3.select(this).attr("stroke", "none");
      d3.select("body").selectAll(".tooltip")
        .transition().duration(50).style("opacity", 0).remove();
    });
}


 
    // --- สร้าง legend ด้านล่าง ---
    wrapper
      .append("div")
      .attr("class", "side-legend text-body")
      .style("margin-top", "4px")
      .style("max-width", "100%")
      .style("overflow", "hidden")
      .html(() => {
        return (
          `<div class="text-body" style="font-weight:600; margin-bottom:6px;">${lastCategory} — total ${total} 
          <i style="font-size:11px;">  ** 1ช่อง ≈ ${factor} โหวต</i></div>` +
          top
            .map(([party, count]) => {
              const color = colorByParty[party] || "#bbb";
              const dimStyle = selectedParty && party !== selectedParty ? "opacity:0.35" : "";
              const percent = (count / totalMPs) * 100;
              const displayCount = `${count} (${percent.toFixed(1)}%)`;
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin:3px 0;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:12px; height:12px; background:${color}; display:inline-block;"></span>
                    <span class="text-body" style="font-size:13px;">${party}</span>
                  </div>
                  <div class="text-body-secondary" style="${dimStyle}; font-size:13px">${displayCount}</div>
                </div>
              `;
            })
            .join("")
        );
      });
  }

  // --- Event listeners ---
  eventBus.on("waffle:selected", rec => {
    lastRecord = rec;
    lastCategory = lastCategory || "agree";
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

  // --- Initial render ---
  if (lastRecord) render();

  // --- Public API ---
  return { setShape, render };
}
