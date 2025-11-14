// pieChart.js
export function createPieChart(containerSelector, eventBus, latestRecord) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // --- Initial D3 Dimensions (These will be updated on resize) ---
  let W = 320;
  let H = 320;
  let R = 130;

  // Function to get the current container size
  function getContainerSize() {
    const refEl = container.node();
    const w = refEl?.clientWidth || 400;
    const h = refEl?.clientHeight || w; // Default to square
    // Use the smallest dimension for the chart circle to ensure it fits
    const size = Math.min(w, h);
    
    // Set chart dimensions based on container size
    W = size;
    H = size;
    // UPDATED: Decreased factor from 0.4 to 0.35 to reduce radius
    R = size * 0.35; // Radius is now about 30% of the container size 

    return { W, H, R };
  }
  
  // Get initial size
  getContainerSize();

  // --- Label Thai ---
  const labelsTh = {
    agree: "เห็นด้วย",
    disagree: "ไม่เห็นด้วย",
    abstain: "งดออกเสียง",
    novote: "ไม่ลงคะแนน",
  };

  // --- Colors ---
  const colors = {
    agree: "#447a5f",
    disagree: "#832d51",
    abstain: "#eed571ff",
    novote: "#404553",
  };

  // --- Structure ---
  const chartWrapper = container
  .append("div")  
  .attr("class", "pie-chart-content-wrapper")
  .style("width", "100%")
  .style("height", "100%")
  .style("display", "flex")
  .style("flex-direction", "column")
  .style("align-items", "lex-start")
  .style("justify-content", "lex-start")
  .style("overflow", "hidden"); 

  // 👉 Add title ABOVE the SVG here
  const titleContainer = chartWrapper
    .append("div")
    .attr("class", "pie-title")
    .style("display", "none")     // Hidden until data is set
    .style("width", "100%")
    .style("text-align", "left")
    .style("font-size", "1.05rem")
    .style("font-weight", "700")
    .style("margin-bottom", "3px")
    .style('margin-top', '6px')
    .style("cursor", "pointer")
    .datum(null); 

  // SVG (below title)
  const svg = chartWrapper
  .append("svg")
  .attr("width", "100%")
  .attr("height", "100%")
  .attr("viewBox", `0 0 ${W} ${H}`)
  .attr("preserveAspectRatio", "xMidYMid meet")
  .style("display", "block");


  // G element for chart translation
  const g = svg.append("g")
    .attr("transform", `translate(${W / 2}, ${H / 2})`);


  const legendContainer = chartWrapper
    .append("div")
    .style("margin-top", "12px")
    .style("font-size", "0.6rem")
    .attr("class", "legend-container");

  // --- D3 Generators ---
  const pie = d3.pie().value(d => d[1]).sort(null);
  let arc = d3.arc().outerRadius(R).innerRadius(0); // Initial arc generator
  let arcHover = d3.arc().outerRadius(R + 8).innerRadius(0); // Initial hover arc generator

  let currentData = null; // Store data for redraw

  // --- Redraw function (for resizing) ---
  function redraw() {
      // 1. Recalculate dimensions based on container size
      getContainerSize();

      // 2. Update SVG viewBox and G translation
      svg.attr("viewBox", `0 0 ${W} ${H}`);
      g.attr("transform", `translate(${W / 2}, ${H / 2})`);
      
      // 3. Update arc generators with new radius
      arc = d3.arc().outerRadius(R).innerRadius(0);
      arcHover = d3.arc().outerRadius(R + 8).innerRadius(0);

      // 4. Redraw paths if data exists
      if (currentData) {
          g.selectAll("path.slice")
              .data(pie(currentData), d => d.data[0])
              .attr("d", arc); // Apply new path definition
      }
  }


  // --- Update Function ---
  function update(record) {
    // Reset UI
    titleContainer.text("");
    titleContainer.datum(null);
    chartWrapper.select(".pie-header-prompt")?.remove();
    g.selectAll("path.slice").remove(); // Use g for selections
    legendContainer.selectAll("*").remove();
    currentData = null;

    // --- Case 1: No record selected ---
    if (!record) {
      if (latestRecord) {
        record = latestRecord;
      } else {
        chartWrapper
          .append("div")
          .attr("class", "pie-header-prompt")
          .style("font-weight", "700")
          .style("text-align", "center")
          .style("padding", "100px 0")
          .text("Select a title to view vote %");
        return;
      }
    }

        // --- Case 2: Record selected (or latestRecord is now set) ---
    titleContainer
      .html(`
        <div class="pie-chart-title"
            style="text-align:left;font-size:1.2rem;font-weight:800;margin-bottom:4px;">
          ผลที่ได้มี มติเอกฉันท์ หรือ เสียงแตก
        </div>
        <div class="pie-chart-subtitle text-body"
            style="text-align:left;font-size:0.9rem;font-weight:600;opacity:.9;margin-bottom:4px;">
          สัดส่วนการโหวตมติภายในวาระการประชุม
        </div>
        <p class="pie-title-text" style="text-align:left;font-size:0.8rem;margin-bottom:4px;"> มติ: 
            ${record.title}
          </p>
      `)
      .style("display", "block")
      .datum(record);


    currentData = Object.entries(
      record.categoryPercentages || {
        agree: 0,
        disagree: 0,
        abstain: 0,
        novote: 0,
      }
    );

    // --- PIE SLICES ---
    const slices = g.selectAll("path.slice").data(pie(currentData), d => d.data[0]);

    slices
      .join("path")
      .attr("class", "slice")
      .attr("fill", d => colors[d.data[0]])
      .attr("d", arc)
      .attr("opacity", 0)
      .on("click", (_, d) =>
        eventBus.dispatch("pie:categorySelected", d.data[0])
      )
      .on("mouseover", function (_, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("d", arcHover)
          .attr("opacity", 1);
      })
      .on("mouseout", function () {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("d", arc)
          .attr("opacity", 0.9);
      })
      .transition()
      .delay((_, i) => i * 100)
      .duration(400)
      .attr("opacity", 0.9);

    // --- LEGEND (uses HTML/CSS for responsiveness) ---
    legendContainer
      .selectAll(".legend-item")
      .data(currentData, d => d[0])
      .join("div")
      .attr("class", "legend-item")
      .attr("data-category", d => d[0])
      .style("opacity", 0)
      .html(
        d => `
        <div class="legend-color-square" style="background:${colors[d[0]]}"></div>
        <span class="legend-name">${labelsTh[d[0]]}</span>
        <span class="legend-percentage">${d[1].toFixed(1)}%</span>
      `
      )
      .transition()
      .delay((_, i) => i * 120)
      .duration(400)
      .style("opacity", 1);
  }

  // --- Click handler for the title ---
  // titleContainer.on("click", function() {
  //   const record = d3.select(this).datum(); 
  //   if (record) {
  //     eventBus.dispatch("details:show", record);
  //   }
  // });

  // --- Resize Observer (for D3 responsiveness) ---
  let ro;
  function applyResize() {
    // Only call redraw in the next animation frame for stability
    window.requestAnimationFrame(redraw);
  }
  
  const selfTarget = container.node();
  if (selfTarget) { 
    ro = new ResizeObserver(applyResize); 
    ro.observe(selfTarget); 
  }
  
  // Clean up observer on destruction (not defined here, but good practice)
  
  // --- Event Listeners ---
  eventBus.on("waffle:selected", d => update(d));
  eventBus.on("year:filterChanged", () => update(null));
  
  // ⬇️⬇️ ฟังสัญญาณจาก circle/waffle เพื่ออัปเดตพาย
  eventBus.on?.("waffle:select", ({ record }) => { if (record) update(record); });
  eventBus.on?.("pie:select",    ({ record }) => { if (record) update(record); });


  // Initial call to display the latest record
  update(latestRecord); 

  // Call redraw once initially to set the correct size based on container
  redraw();


  function destroy() {
    if (ro) ro.disconnect();
    container.selectAll("*").remove();
    currentData = null;
  }

  return { update, destroy };
}
