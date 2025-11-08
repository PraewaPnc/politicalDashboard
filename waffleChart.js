// waffleChart.js
export function createWaffleChart(containerSelector, records, eventBus) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();
  
  // --- NEW: Add Chart Title ---
  // Determine the year being displayed to include it in the title
  const currentYear = records.length > 0 ? records[0].year : 'Data';

  container.append("div")
    .attr("class", "waffle-chart-title text-body")
    .style("text-align", "left")
    .style("font-size", "1.2rem") // h4 size
    .style("font-weight", "bold")
    .style("margin-bottom", "10px")
    .text(`Voting Attendance by Month (${currentYear})`);
  // ---------------------------

  // --- Internal State for Selection ---
  const getRecordId = (d) => `${d.dateStr || ''}-${d.title || ''}`;
  
  // --- Find the latest record ---
  const latestRecord = records
    .slice() // Create a copy to sort
// ... (rest of the sorting and state initialization remains the same)
// ...
    .sort((a, b) => {
      // Sort in descending order to get the latest first
      const dateCompare = (b.dateStr || "").localeCompare(a.dateStr || "");
      if (dateCompare !== 0) return dateCompare;
      // Tie-breaker: sort by title
      return b.title.localeCompare(a.title);
    })[0];
    
  // Initialize selection state with the latest record
  let selectedRecordId = latestRecord ? getRecordId(latestRecord) : null;
  // --- End Internal State ---

  // --- Configurations ---
  const cellSize = 22;
// ... (rest of configurations and data prep are unchanged)
// ...
  const gap = 4;
  const labelWidth = 78;
  const rows = 12;

  const monthNames = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];

  const colorScale = d3.scaleLinear()
    .domain([0, 100])
    .range(["#ffffff", "#004d1a"]);

  // --- Data Preparation ---
  // Group records by month
  const recordsByMonth = d3.group(records, d => d.month);
  // Ensure all 12 months exist, even if empty
  for (let m = 1; m <= 12; m++) {
    if (!recordsByMonth.has(m)) recordsByMonth.set(m, []);
  }

  // Compute layout dimensions
  const countsPerMonth = Array.from({ length: 12 }, (_, i) =>
    (recordsByMonth.get(i + 1) || []).length
  );
  const maxPerRow = Math.max(1, ...countsPerMonth);
  const chartWidth = labelWidth + maxPerRow * (cellSize + gap) + 20;
  
  // ADJUSTED: Height to accommodate the legend at the bottom
  const legendHeight = 40;
  const height = rows * (cellSize + gap) + 40 + legendHeight;

  // --- Create SVG ---
  const svg = container.append("svg")
    .attr("width", chartWidth)
    .attr("height", height);
    
  // ... (rest of the chart drawing logic, month rows, squares, and legend is unchanged)
  
  // Chart Group
  const g = svg.append("g").attr("transform", "translate(0,12)");

  // --- Draw Each Month Row ---
  monthNames.forEach((month, i) => {
    const monthIndex = i + 1;
    const y = i * (cellSize + gap);

    // Get and sort records (This is still needed for waffle square placement, but not for the label text)
    const monthRecords = (recordsByMonth.get(monthIndex) || [])
      .slice()
      .sort((a, b) =>
        a.dateStr === b.dateStr
          ? a.title.localeCompare(b.title)
          : (a.dateStr || "").localeCompare(b.dateStr || "")
      );

    // Draw month label
    g.append("text")
      .attr("x", 8)
      .attr("y", y + cellSize - 2)
      .attr("font-size", 15)
      .attr("font-weight", "bold")
      .html(`<tspan class="text-body">${month}</tspan>`);

    // Draw waffle squares
    const rowGroup = g.append("g")
      .attr("transform", `translate(${labelWidth},${y})`);

    const squares = rowGroup.selectAll("rect")
      .data(monthRecords)
      .join("rect")
      .attr("class", "waffle-square")
      .classed("selected", d => getRecordId(d) === selectedRecordId)
      
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("rx", 3) // rounded corners
      .attr("ry", 3)
      .attr("x", (_, i) => i * (cellSize + gap))
      .attr("fill", d => colorScale(Math.max(0, Math.min(100, d.presentPercent || 0))))
      
      .on("click", function(event, d) {
        // 1. Update the internal state
        selectedRecordId = getRecordId(d);
        
        // 2. Clear highlight from all squares (D3 way: update all elements in the container)
        container.selectAll(".waffle-square").classed("selected", false);
        
        // 3. Highlight the clicked square
        d3.select(this).classed("selected", true);
        
        // 4. Dispatch the event
        eventBus.dispatch("waffle:selected", d);
      })
      
      .on("mouseover", (event, d) => eventBus.dispatch("tooltip:show", { event, record: d }))
      .on("mousemove", event => eventBus.dispatch("tooltip:move", { event }))
      .on("mouseout", () => eventBus.dispatch("tooltip:hide"));

    // Remove default browser tooltip
    squares.attr("title", null);
  });
  
  // ------------------------------------
  // NEW: Draw Color Scale Legend (Moved to the bottom)
  // ------------------------------------
  const legendGroup = svg.append("g")
    .attr("transform", `translate(0, ${height - legendHeight + 10})`); // Position at bottom of SVG

  const legendWidth = chartWidth - 300;
  const legendBarHeight = 12;
  const legendX = 8; // Start slightly in from the left

  // 1. Draw the gradient bar
  const linearGradient = svg.append("defs")
    .append("linearGradient")
    .attr("id", "color-scale-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%");

  linearGradient.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", colorScale(0)); // Lightest color

  linearGradient.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", colorScale(100)); // Darkest color

  legendGroup.append("rect")
    .attr("x", legendX)
    .attr("y", 0)
    .attr("width", legendWidth)
    .attr("height", legendBarHeight)
    .style("fill", "url(#color-scale-gradient)");

  // 2. Draw the labels (0%, 100%)
  legendGroup.append("text")
    .attr("x", legendX)
    .attr("y", legendBarHeight + 15)
    .attr("font-size", 10)
    .attr("text-anchor", "start")
    // Use text-body class for dark mode compatibility
    .html('<tspan class="text-body">0%</tspan>');

  legendGroup.append("text")
    .attr("x", legendX + legendWidth)
    .attr("y", legendBarHeight + 15)
    .attr("font-size", 10)
    .attr("text-anchor", "end")
    // Use text-body class for dark mode compatibility
    .html('<tspan class="text-body">100%</tspan>');
    
  legendGroup.append("text")
    .attr("x", legendX + legendWidth / 2)
    .attr("y", legendBarHeight + 15)
    .attr("font-size", 10)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    // Use text-body class for dark mode compatibility
    .html('<tspan class="text-body">Present (%)</tspan>');

  // --- Event Handlers (Unchanged) ---
  eventBus.on("waffle:selected", d => {
    selectedRecordId = getRecordId(d);
    container.selectAll(".waffle-square")
      .classed("selected", d => getRecordId(d) === selectedRecordId);
  });

  return { latestRecord };
}