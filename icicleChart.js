import { buildAbsenceHierarchy } from "./data.js";

export function createIcicleChart(containerSelector, records, partyColors, eventBus) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  // --- Dimensions ---
  const width = 300;
  const height = 300;
  const margin = { top: 20, right: 10, bottom: 10, left: 10 };

  // --- SVG Setup ---
  const svg = container.append("svg").attr("viewBox", [0, 0, width, height]);

  const g = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);

  // Header text
  const header = svg.append("text")
    .attr("x", margin.left)
    .attr("y", 14)
    .attr("font-size", "1.05rem")
    .attr("font-weight", 600)
    .attr("fill", "#333");

  const defaultColor = "#ccc";

  // --- Data ---
  const rootAll = buildAbsenceHierarchy(records);
  let currentRoot = null;
  let currentYearNode = null;

  // --- Scales ---
  const x = d3.scaleLinear().range([0, width - margin.left - margin.right]);
  const y = d3.scaleLinear().range([0, height - margin.top - margin.bottom]);

  // --- Partition layout ---
  const partition = data =>
    d3.partition()
      .size([height - margin.top - margin.bottom, width - margin.left - margin.right])
      .padding(1)(
        d3.hierarchy(data).sum(d => d.value)
      );

  // --- Draw the icicle chart for the given year ---
  function drawYear(year) {
    g.selectAll("*").remove();
    header.style("font-size", "0.75rem").text(`Absence Record for ${year}`);

    if (!rootAll?.children) return;

    currentYearNode = rootAll.children.find(c => c.name === String(year));

    if (!currentYearNode || !currentYearNode.children?.length) {
      g.append("text")
        .attr("x", (width - margin.left - margin.right) / 2)
        .attr("y", (height - margin.top - margin.bottom) / 2 - 20)
        .attr("text-anchor", "middle")
        .text(`No absence data for ${year}`);
      return;
    }

    currentRoot = partition(currentYearNode);

    x.domain([0, currentRoot.y1]);
    y.domain([0, currentRoot.x1]);

    const nodes = g.selectAll("g")
      .data(currentRoot.descendants())
      .join("g")
      .attr("transform", d => `translate(${x(d.y0)}, ${y(d.x0)})`);

    // Rectangles
    nodes.append("rect")
      .attr("width", d => x(d.y1) - x(d.y0))
      .attr("height", d => y(d.x1) - y(d.x0))
      .attr("fill-opacity", 0.8)
      .attr("fill", d => {
        if (d.depth === 0) return "#c4bbbbff"; // root (year)
        if (d.depth === 1) return partyColors[d.data.name] || defaultColor; // party
        return partyColors[d.parent.data.name] || defaultColor; // voter
      })
      .style("cursor", "pointer")
      .on("click", (_, d) => zoomToNode(d));

    // Labels
    nodes.append("text")
      .attr("x", 4)
      .attr("y", 14)
      .attr("font-size", "10px")
      .attr("clip-path", d => `url(#clip-${d.data.name}-${d.depth})`)
      .text(d => formatLabel(d));

    // Clip paths for text clipping
    svg.select("defs").remove();
    svg.append("defs")
      .selectAll("clipPath")
      .data(currentRoot.descendants())
      .join("clipPath")
      .attr("id", d => `clip-${d.data.name}-${d.depth}`)
      .append("rect")
      .attr("width", d => x(d.y1) - x(d.y0))
      .attr("height", d => y(d.x1) - y(d.x0));

    // Tooltips
    nodes.append("title")
      .text(d => `${d.ancestors().map(a => a.data.name).reverse().join(" / ")}\n${formatLabel(d, true)}`);
  }

  // --- Format label for nodes ---
  function formatLabel(d, forTooltip = false) {
    if (!currentYearNode) return "";
    const totalTitles = currentYearNode.totalTitles || 1;
    let label = d.data.name;
    let pct = 0;

    if (d.depth === 0) {
      pct = (d.value / (totalTitles * d.leaves().length)) * 100;
      if (forTooltip) return `${d.value} total absences.`;
    } else if (d.depth === 1) {
      pct = (d.value / totalTitles) * 100;
      if (label.length > 15) label = label.slice(0, 15) + "...";
      return `${label}: ${d.value} (${pct.toFixed(1)}%)`;
    } else if (d.depth === 2) {
      pct = (d.value / totalTitles) * 100;
      if (label.length > 20) label = label.slice(0, 20) + "...";
      return `${label}: ${d.value} (${pct.toFixed(1)}%)`;
    }

    return label;
  }

  // --- Zoom to clicked node ---
  function zoomToNode(node) {
    x.domain([node.y0, node.y1]);
    y.domain([node.x0, node.x1]);

    const transition = svg.transition().duration(750);

    g.selectAll("g").transition(transition)
      .attr("transform", d => `translate(${x(d.y0)}, ${y(d.x0)})`);

    g.selectAll("rect").transition(transition)
      .attr("width", d => x(d.y1) - x(d.y0))
      .attr("height", d => y(d.x1) - y(d.x0));

    g.selectAll("text").transition(transition)
      .attr("fill-opacity", d => (x(d.y1) - x(d.y0) > 40 ? 1 : 0));

    svg.selectAll("defs rect").transition(transition)
      .attr("width", d => x(d.y1) - x(d.y0))
      .attr("height", d => y(d.x1) - y(d.x0));
  }

  // --- Update handler ---
  function update(year) {
    drawYear(year);
  }

  // --- Event Bus Subscription ---
  if (eventBus?.on) {
    eventBus.on("year:filterChanged", update);
  }
}
