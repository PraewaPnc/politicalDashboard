// pieChart.js
export function createPieChart(containerSelector, eventBus, latestRecord) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // --- Dimensions ---
  const width = 320;
  const height = 320;
  const radius = 130;

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
    .attr("class", "pie-chart-content-wrapper");

  // 👉 Add title ABOVE the SVG here
  const titleContainer = chartWrapper
    .append("div")
    .attr("class", "pie-title")
    .style("text-align", "center")
    .style("font-size", "1.05rem")
    .style("font-weight", "700")
    .style("margin-bottom", "3px")
    .style('margin-top', '6px')
    // NEW: Add pointer cursor to indicate clickability
    .style("cursor", "pointer")
    // NEW: Store the last record that was displayed in the DOM element's datum
    .datum(null); 

  // SVG (below title)
  const svg = chartWrapper
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", `translate(${width / 2}, ${height / 2})`);

  const legendContainer = chartWrapper
    .append("div")
    .style("margin-top", "12px")
    .style("font-size", "0.6rem")
    .attr("class", "legend-container");

  // --- D3 Generators ---
  const pie = d3.pie().value(d => d[1]).sort(null);
  const arc = d3.arc().outerRadius(radius).innerRadius(0);
  const arcHover = d3.arc().outerRadius(radius + 8).innerRadius(0);

  // --- Update Function ---
  function update(record) {
    // Reset UI
    titleContainer.text("");
    titleContainer.datum(null); // Clear stored record on reset
    chartWrapper.select(".pie-header-prompt")?.remove();
    svg.selectAll("path.slice").remove();
    legendContainer.selectAll("*").remove();

    // --- Case 1: No record selected ---
    if (!record) {
      // If no record is selected, use the latestRecord
      if (latestRecord) {
        record = latestRecord;
      } else {
        // If there's no latest record, display the prompt
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
      .html(
        `<p class="pie-title-text text-body link-offset-3 link-underline-opacity-0">
        ${record.title}<span class="pie-date-text text-body-secondary"> — ${record.dateStr}</span></p>`
      )
      // NEW: Store the current record in the DOM element's datum
      .datum(record);

    const data = Object.entries(
      record.categoryPercentages || {
        agree: 0,
        disagree: 0,
        abstain: 0,
        novote: 0,
      }
    );

    // --- PIE SLICES ---
    const slices = svg.selectAll("path.slice").data(pie(data), d => d.data[0]);

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

    // --- LEGEND ---
    legendContainer
      .selectAll(".legend-item")
      .data(data, d => d[0])
      .join("div")
      .attr("class", "legend-item")
      .attr("data-category", d => d[0])
      .style("opacity", 0)
      .html(
        d => `
        <div class="legend-color-square" style="background:${colors[d[0]]}"></div>
        <span class="legend-name">${d[0]}</span>
        <span class="legend-percentage">${d[1].toFixed(1)}%</span>
      `
      )
      .transition()
      .delay((_, i) => i * 120)
      .duration(400)
      .style("opacity", 1);
  }

  // --- NEW: Click handler for the title ---
  titleContainer.on("click", function() {
    // Retrieve the record stored in the datum
    const record = d3.select(this).datum(); 
    if (record) {
      // Dispatch the record to be picked up by popup.js
      eventBus.dispatch("details:show", record);
    }
  });

  // --- Event Listeners ---
  eventBus.on("waffle:selected", d => update(d));
  eventBus.on("year:filterChanged", () => update(null));
  
  // ⬇️⬇️ [ADD] ฟังสัญญาณจาก circle/waffle เพื่ออัปเดตพาย (คงรูปแบบเดิม)
  eventBus.on?.("waffle:select", ({ record }) => { if (record) update(record); });
  eventBus.on?.("pie:select",    ({ record }) => { if (record) update(record); });


  // Initial call to display the latest record
  update(latestRecord); 

  return { update };
}