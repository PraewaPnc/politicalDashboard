import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export function createWaffleChart(containerSelector, records, eventBus) {
  const bus = eventBus ?? createMiniBus();
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  const currentYear = records.length > 0 ? records[0].year : "Data";
  container.append("div")
    .attr("class", "waffle-chart-title text-body")
    .style("text-align", "left")
    .style("font-size", "1.2rem")
    .style("font-weight", "bold")
    .style("margin-bottom", "10px")
    .text(`การเข้าร่วมลงมติรายเดือน ปี ${currentYear}`);

  const getRecordId = (d) => `${d.dateStr || ""}-${d.title || ""}`;

  const getCircleKey = (d) =>
    d?.Bill?.id ?? d?.id ?? d?.billId ?? d?.vote_event_id ?? d?.title ?? d?.Bill?.title;

  const latestRecord = records
    .slice()
    .sort((a, b) => {
      const dateCompare = (b.dateStr || "").localeCompare(a.dateStr || "");
      return dateCompare !== 0 ? dateCompare : b.title.localeCompare(a.title);
    })[0];

  let selectedRecordId = latestRecord ? getRecordId(latestRecord) : null;

  // --- สีและสถิติ ---
  const allPercents = records.map((d) => d.presentPercent || 0);
  const stats = {
    min: d3.min(allPercents),
    max: d3.max(allPercents),
    mean: d3.mean(allPercents),
    median: d3.median(allPercents),
    deviation: d3.deviation(allPercents),
    percentiles: [25, 50, 75].map((p) =>
      d3.quantile(allPercents.slice().sort(d3.ascending), p / 100)
    ),
  };
  console.table(stats);

  const colorScale = d3
    .scaleThreshold()
    .domain([60, 75, 85, 95])
    .range([
      "#f4e1ff", // 0–59%
      "#d6a4e0", // 60–74%
      "#a659b4", // 75–84%
      "#6d3479", // 85–94%
      "#2d0f2e", // 95–100%
    ]);

  const monthNames = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ];

  const recordsByMonth = d3.group(records, (d) => d.month);
  for (let m = 1; m <= 12; m++) {
    if (!recordsByMonth.has(m)) recordsByMonth.set(m, []);
  }

  // --- ✅ คำนวณขนาดกราฟแบบ Dynamic ---
  const countsPerMonth = Array.from({ length: 12 }, (_, i) =>
    (recordsByMonth.get(i + 1) || []).length
  );

  // ใช้จำนวนสี่เหลี่ยมมากที่สุดของทุกเดือนเพื่อคำนวณความกว้าง
  const maxSquaresPerRow = Math.max(1, ...countsPerMonth);

  // ป้องกันกรณีข้อมูลน้อย ให้มีขั้นต่ำ
  const FIXED_MIN_SQUARES = 20;
  const effectiveSquaresPerRow = Math.max(maxSquaresPerRow, FIXED_MIN_SQUARES);

  const cellSize = 22;
  const gap = 4;
  const labelWidth = 100;
  const legendHeight = 40;
  const rows = 12;

  // ป้องกัน legend ชน
  const MIN_CHART_WIDTH = 400;

  // คำนวณขนาดภายในตามข้อมูลจริง
  const DYNAMIC_DRAW_WIDTH =
    labelWidth + effectiveSquaresPerRow * (cellSize + gap) + 40;
  const INTERNAL_WIDTH = Math.max(DYNAMIC_DRAW_WIDTH, MIN_CHART_WIDTH);

  const INTERNAL_HEIGHT =
    rows * (cellSize + gap) + 40 + legendHeight + 20;

  // --- SVG แบบ responsive ---
  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${INTERNAL_WIDTH} ${INTERNAL_HEIGHT}`)
    .attr("preserveAspectRatio", "xMinYMin meet");

  const g = svg.append("g").attr("transform", "translate(0,12)");

  // --- สร้างสี่เหลี่ยมแต่ละเดือน ---
  monthNames.forEach((month, i) => {
    const monthIndex = i + 1;
    const y = i * (cellSize + gap);

    const monthRecords = (recordsByMonth.get(monthIndex) || [])
      .slice()
      .sort((a, b) =>
        a.dateStr === b.dateStr
          ? a.title.localeCompare(b.title)
          : (a.dateStr || "").localeCompare(b.dateStr || "")
      );

    g.append("text")
      .attr("class", "waffle-month text-body")    
      .attr("x", 8)
      .attr("y", y + cellSize - 2)
      .attr("font-size", 15)
      .attr("font-weight", "bold")
      .attr("fill", "var(--bs-body-color)")      
      .text(month);

    const rowGroup = g
      .append("g")
      .attr("transform", `translate(${labelWidth},${y})`);

    const squares = rowGroup
      .selectAll("rect")
      .data(monthRecords)
      .join("rect")
      .attr("class", "waffle-square")
      .classed("selected", (d) => getRecordId(d) === selectedRecordId)
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("rx", 3)
      .attr("ry", 3)
      .attr("x", (_, i) => i * (cellSize + gap))
      .attr("fill", (d) =>
        colorScale(Math.max(0, Math.min(100, d.presentPercent || 0)))
      )
      .on("click", function (event, d) {
        selectedRecordId = getRecordId(d);
        container.selectAll(".waffle-square")
          .classed("selected", false)
          .attr("opacity", 0.35);
        d3.select(this).classed("selected", true).attr("opacity", 1.0);

        bus.dispatch("waffle:selected", d);
        const key = getCircleKey(d);
        bus.dispatch("waffle:select", {
          billId: key,
          title: d?.title ?? d?.Bill?.title,
          record: d,
        });

        event.stopPropagation();
      })
      .on("mouseover", (event, d) =>
        bus.dispatch("tooltip:show", { event, record: d })
      )
      .on("mousemove", (event) => bus.dispatch("tooltip:move", { event }))
      .on("mouseout", () => bus.dispatch("tooltip:hide"));

    squares.attr("title", null);
  });

  // คลิกพื้นที่ว่างเพื่อล้าง selection
  svg.on("click", (evt) => {
    if (evt.target === svg.node()) {
      selectedRecordId = null;
      container.selectAll(".waffle-square")
        .classed("selected", false)
        .attr("opacity", 1.0);
      bus.dispatch("waffle:clear");
    }
  });

  // --- Legend ---
  const fixedLegendWidth = 280;
  const legendHeightBar = 14;
  const numColors = 5;
  const boxWidth = fixedLegendWidth / numColors;

  const colorRange = [
    "#f4e1ff",
    "#d6a4e0",
    "#a659b4",
    "#6d3479",
    "#2d0f2e",
  ];

  const thresholdLabels = ["<60%", "60–74%", "75–84%", "85–94%", "95–100%"];

  const legendGroup = svg.append("g")
    .attr("transform", `translate(10, ${INTERNAL_HEIGHT - legendHeight + 10})`);

  for (let i = 0; i < numColors; i++) {
    const x = i * boxWidth;

    legendGroup.append("rect")
      .attr("x", x)
      .attr("y", 0)
      .attr("width", boxWidth)
      .attr("height", legendHeightBar)
      .attr("fill", colorRange[i]);

    legendGroup.append("text")
      .attr("class", "legend-label")                 
      .attr("x", x + boxWidth / 2)
      .attr("y", legendHeightBar + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", "var(--bs-body-color)")          
      .text(thresholdLabels[i]);
  }

  // --- Sync ---
  bus.on("waffle:selected", (d) => {
    selectedRecordId = getRecordId(d);
    container.selectAll(".waffle-square")
      .classed("selected", (r) => getRecordId(r) === selectedRecordId)
      .attr("opacity", (r) => (getRecordId(r) === selectedRecordId ? 1.0 : 0.35));
  });

  bus.on?.("waffle:select", ({ billId, title, record }) => {
    const key = String(billId ?? title ?? "");
    if (!key) return;

    let target = null;
    container.selectAll(".waffle-square").each(function (d) {
      if (target) return;
      const k = String(getCircleKey(d));
      if (k === key || String(d.title || "") === key) target = d;
    });
    if (!target && record) target = record;
    if (!target) return;

    selectedRecordId = getRecordId(target);
    container.selectAll(".waffle-square")
      .classed("selected", (r) => getRecordId(r) === selectedRecordId)
      .attr("opacity", (r) => (getRecordId(r) === selectedRecordId ? 1.0 : 0.35));

    bus.dispatch("waffle:selected", target);
  });

  return { latestRecord };
}

/* ------------ mini bus (สำหรับกรณีไม่มี bus ส่งเข้ามา) ------------ */
function createMiniBus() {
  const map = new Map();
  return {
    on(evt, fn) { map.set(evt, (map.get(evt) || []).concat(fn)); },
    dispatch(evt, payload) { (map.get(evt) || []).forEach((fn) => fn(payload)); },
  };
}
