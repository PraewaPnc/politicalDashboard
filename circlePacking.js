// circlePacking.js
// Zoomable circle packing + interaction กับ Waffle/Pie ผ่าน event bus
// - กลุ่มผลโหวต 3 วง: "ผ่าน" / "ไม่ผ่าน" / "N/A(รอรวบรวมผล)"
// - ชั้นถัดไปแยก "ปี"
// - วงในสุด (leaf = 1 พ.ร.บ./เรื่อง) ขนาด = |agree - disagree| / present   // ✅ สูตรข้อ 4
// - คลิกใบ (leaf): ไม่ซูม แต่ไฮไลต์ + สัญญาณให้ Waffle (waffle:select)
// - YEAR FILTER: ปีที่เลือกเป็นสีปกติ ปีอื่นเป็นเทา
// - TITLE BAR: "สถานะการลงมติ" + ชื่อเรื่องที่เลือก (คลิกเพื่อ popup: details:show)
// - LEGEND (MINIMAL): ข้อความภาษาคนทั่วไปตามที่ผู้ใช้เลือก

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export function createCirclePacking(containerSelector, allRecords, PARTY_COLORS, bus, options = {}) {
  const keepSquare = options.keepSquare ?? true;
  const legendMode = options.legendMode ?? "minimal";

  /* ---------------- Getters (รองรับหลาย schema) ---------------- */
  const getters = {
    result:   (d) => d?.VoteEvent?.result ?? d?.result ?? d?.vote_result ?? "N/A",
    title:    (d) => d?.title ?? d?.Bill?.title ?? d?.VoteEvent?.title ?? d?.name ?? "ไม่ทราบชื่อ",
    id:       (d) => d?.Bill?.id ?? d?.bill_id ?? d?.id ?? d?.vote_event_id ?? getters.title(d),
    year:     (d) => {
      const y = d?.year ?? d?.VoteEvent?.year ?? d?.VoteEvent?.date ?? d?.date ?? d?.meeting_date ?? null;
      if (!y) return "ไม่ทราบปี";
      const s = String(y);
      const m = s.match(/(19|20)\d{2}/);
      if (m) return m[0];
      const dt = new Date(s);
      return !isNaN(dt) ? String(dt.getFullYear()) : "ไม่ทราบปี";
    },
    agree:    (d) => d?.VoteEvent?.agree_count    ?? d?.agree_count    ?? d?.yea ?? d?.approve ?? d?.for ?? d?.voteAgree ?? 0,
    disagree: (d) => d?.VoteEvent?.disagree_count ?? d?.disagree_count ?? d?.nay ?? d?.reject  ?? d?.against ?? d?.voteDisagree ?? 0,
    present:  (d) => d?.presentCount ?? d?.present ?? d?.attend_count ?? d?.present_total ?? d?.VoteEvent?.present_count ?? 0,
  };

  /* ---------------- Normalize result → PASS / FAIL / N/A ---------------- */
  const PASS = "ผ่าน";
  const FAIL = "ไม่ผ่าน";
  const NA   = "N/A";

  function normalizeResult(x) {
    const s = String(x || "").trim().toLowerCase();
    if (["ผ่าน","pass","approved","approve","passed"].includes(s)) return PASS;
    if (["ไม่ผ่าน","fail","failed","rejected","reject"].includes(s)) return FAIL;
    return NA;
  }

  function displayResultName(key) {
    return key === NA ? "รอรวบรวมผล" : key;
  }

  /* ---------------- Build hierarchy: root → result → year → leaf ---------------- */
  function buildHierarchy(records, leafValueFn) {
    const byResult = new Map([[PASS, new Map()], [FAIL, new Map()], [NA, new Map()]]);
    for (const r of records) {
      const res   = normalizeResult(getters.result(r));
      const yr    = getters.year(r);
      const title = getters.title(r);
      const id    = getters.id(r);

      const value = Math.max(0, Number(leafValueFn?.(r, res) ?? 0)); // กัน NaN/ติดลบ
      if (!byResult.get(res).has(yr)) byResult.get(res).set(yr, []);
      byResult.get(res).get(yr).push({ name: title, id, value, raw: r });
    }

    const resultChildren = [];
    for (const [resKey, byYear] of byResult.entries()) {
      const years = Array.from(byYear.keys()).sort((a,b)=>{
        const na=+a, nb=+b;
        if (!isNaN(na) && !isNaN(nb)) return nb - na;
        return String(b).localeCompare(String(a));
      });
      resultChildren.push({
        name: displayResultName(resKey),
        key:  resKey,
        children: years.map(y => ({ name: String(y), children: byYear.get(y) }))
      });
    }
    return { name: "Votes", children: resultChildren };
  }

  /* ---------------- Colors ---------------- */
  const COLOR_RESULT = { [PASS]: "#cfdd9d", [FAIL]: "#f8cae4", [NA]: "#b8dcee" };
  const COLOR_YEAR   = { [PASS]: "#a5c4a8", [FAIL]: "#ea6993", [NA]: "#7ea3b8" };
  const COLOR_LEAF   = { [PASS]: "#447a5f", [FAIL]: "#832d51", [NA]: "#234458" };
  const GREY_LIGHT   = "#e6e6e6";
  const GREY_LEAF    = "#c9c9c9";
  const GREY_YEAR    = "#d8d8d8";

  /* ---------------- Container & Title ---------------- */
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  const titleDiv = container.append("div")
    .style("display","flex")
    .style("flex-direction","column")
    .style("align-items","flex-start")
    .style("gap","4px")
    .style("margin-bottom","2px");

  const mainTitleEl = titleDiv.append("div")
    .text("กฎหมายไหนรอด กฎหมายไหนร่วง")
    .style("text-align","left")
    .style("font","600 20px/1.4 Sarabun");

  const selectedTitleEl = titleDiv.append("div")
    .text("")
    .style("font","500 15px/1.3 Sarabun")
    .style("opacity","0.85")
    .style("cursor","pointer")
    .attr("class","cp-selected-title");

  selectedTitleEl.on("click", function() {
    const rec = d3.select(this).datum();
    if (rec) localBus.dispatch("details:show", rec);
  });

  function getContainerSize() {
    const refEl = container.node();
    const w = refEl?.clientWidth || 400;
    const h = refEl?.clientHeight || w;
    const size = keepSquare ? Math.min(w, h || w) : w;
    return { W: size, H: keepSquare ? size : h };
  }
  let { W, H } = getContainerSize();

  const svg = container.append("svg")
    .attr("viewBox", `${-W/2} ${-H/2} ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("display","block")
    .style("cursor","pointer");

  const gCircles    = svg.append("g");
  const gResultLbls = svg.append("g").attr("pointer-events","none");
  const gYearLbls   = svg.append("g").attr("pointer-events","none");

  /* ---------------- Legend (Minimal) — Plain-language version ---------------- */
if (legendMode === "minimal") {
  const bottomLegend = container.append("div")
    .attr("class", "cp-size-legend-bottom")
    .style("display","grid")
    .style("grid-template-rows","auto auto auto")
    .style("justify-items","center")
    .style("row-gap","4px")
    .style("margin-top","6px")
    .style("color","currentColor")
    .style("font-size","12px");

  // ✅ ข้อความภาษาคนทั่วไป
  bottomLegend.append("div")
    .style("opacity", 0.95)
    .style("text-align", "center")
    .html(`
      <b>ขนาดวงกลม = ความสูสีของผลโหวต</b><br>
      
    `);

  // ✅ แถว visual (วงเล็ก → ลูกศร → วงใหญ่)
  const row = bottomLegend.append("div")
    .style("display","grid")
    .style("grid-template-columns","min-content 1fr min-content")
    .style("align-items","center")
    .style("column-gap","6px")
    .style("width","100%")
    .style("max-width","260px");

  const svgLegend = row.append("svg")
    .attr("viewBox","0 0 120 40")
    .attr("preserveAspectRatio","xMidYMid meet")
    .style("width","100%")
    .style("height","40px")
    .style("grid-column","1 / 4")
    .style("overflow","visible");

  const arrowId = `cp-arrow-${Math.random().toString(36).slice(2,8)}`;
  svgLegend.append("defs").append("marker")
    .attr("id", arrowId).attr("viewBox","0 0 8 8")
    .attr("refX","7").attr("refY","4")
    .attr("markerWidth","4").attr("markerHeight","4")
    .attr("orient","auto-start-reverse")
    .append("path").attr("d","M 0 0 L 8 4 L 0 8 z").attr("fill","currentColor");

  // 🔘 ขยับวงกลมขึ้นนิดนึงให้บาลานซ์
  const small = { cx: 15,  cy: 13, r: 3 };
  const large = { cx: 105, cy: 13, r: 8 };

  svgLegend.append("circle")
    .attr("cx", small.cx).attr("cy", small.cy).attr("r", small.r)
    .attr("fill","#bdbdbd").attr("stroke","#9e9e9e");

  svgLegend.append("line")
    .attr("x1", small.cx + small.r + 4).attr("y1", small.cy)
    .attr("x2", large.cx - large.r - 4).attr("y2", large.cy)
    .attr("stroke","currentColor").attr("stroke-width",1.4)
    .attr("marker-end", `url(#${arrowId})`);

  svgLegend.append("circle")
    .attr("cx", large.cx).attr("cy", large.cy).attr("r", large.r)
    .attr("fill","#bdbdbd").attr("stroke","#9e9e9e");

  // ✅ ป้ายใต้แต่ละวงให้ไม่ตัดขอบ (y = 34)
  svgLegend.append("text")
    .attr("x", small.cx).attr("y", 34).attr("text-anchor","middle")
    .style("font","500 12px Sarabun").text("สูสี ≈ 0–10%");

  svgLegend.append("text")
    .attr("x", large.cx).attr("y", 34).attr("text-anchor","middle")
    .style("font","500 12px Sarabun").text("ชนะขาด ≥ 40%");
}

  /* ---------------- State ---------------- */
  let root, focus, view;
  const byId = new Map(), byTitle = new Map();
  let selectedKey = null;
  let selectedNode = null;
  let currentYearFilter = null;
  let lastSelectedRecord = null;

  /* ---------------- Compute (สูตรข้อ 4: margin) ---------------- */
  function compute(records) {
    const leafValueFn = (rec /*, resKey */) => {
      const a = +getters.agree(rec)    || 0;
      const b = +getters.disagree(rec) || 0;
      const p = +getters.present(rec)  || 0;
      if (!p) return 0;
      return Math.abs(a - b) / p; // 0..1 → ใช้เป็น "พื้นที่" ของใบไม้
    };

    const data = buildHierarchy(records ?? [], leafValueFn);

    root = d3.pack().size([W, H]).padding(5)(
      d3.hierarchy(data).sum(d => (typeof d.value === "number" ? d.value : 0)).sort((a,b)=> b.value - a.value)
    );
    focus = root;
    view  = [root.x, root.y, root.r * 2];

    byId.clear(); byTitle.clear();
    for (const n of root.descendants()) {
      if (!n.children) {
        if (n.data?.id != null)  byId.set(String(n.data.id), n);
        if (n.data?.name)        byTitle.set(String(n.data.name), n);
      }
    }

    selectedNode = null;
    if (selectedKey != null) {
      selectedNode = byId.get(String(selectedKey)) ?? byTitle.get(String(selectedKey)) ?? null;
    }
  }

  /* ---------------- Helpers ---------------- */
  function nodeResultKey(n){
    if (!n) return null;
    if (n.depth === 1) return n.data?.key ?? n.data?.name;
    if (n.depth === 2) return n.parent?.data?.key ?? n.parent?.data?.name;
    if (n.depth >= 3)  return n.parent?.parent?.data?.key ?? n.parent?.parent?.data?.name;
    return null;
  }

  function nodeYearName(n) {
    if (!n) return null;
    if (n.depth === 2) return n.data?.name;
    if (n.depth >= 3)  return n.parent?.data?.name;
    return null;
  }

  function isAncestorOrSelf(a, b) {
    if (!a || !b) return false;
    let x = b;
    while (x) { if (x === a) return true; x = x.parent; }
    return false;
  }

  function fillColorFor(d) {
    const resKey = nodeResultKey(d);

    if (currentYearFilter && d.depth >= 2) {
      const y = nodeYearName(d);
      if (String(y) !== String(currentYearFilter)) {
        return d.depth === 2 ? GREY_YEAR : GREY_LEAF;
      }
    }

    if (!selectedNode) {
      if (d.depth === 1) return (COLOR_RESULT[resKey] ?? GREY_LIGHT);
      if (d.depth === 2) return (COLOR_YEAR[resKey]   ?? GREY_LIGHT);
      return (COLOR_LEAF[resKey]   ?? "white");
    }

    const onPath = isAncestorOrSelf(d, selectedNode);
    if (!onPath) return d.depth >= 3 ? GREY_LEAF : GREY_LIGHT;

    if (d.depth === 1) return (COLOR_RESULT[resKey] ?? GREY_LIGHT);
    if (d.depth === 2) return (COLOR_YEAR[resKey]   ?? GREY_LIGHT);
    return (COLOR_LEAF[resKey]   ?? "white");
  }

  /* ---------------- Render ---------------- */
  function render() {
    compute(allRecords);

    const nodes = root.descendants().slice(1);

    const circles = gCircles.selectAll("circle")
      .data(nodes, d => d.data?.id ?? d.data?.name ?? Math.random())
      .join(
        enter => enter.append("circle")
          .attr("fill", fillColorFor)
          .attr("stroke", d => d.depth >= 3 ? "#999" : "none")
          .attr("pointer-events", null)
          .on("mouseover", function(){ d3.select(this).attr("stroke", "#000"); })
          .on("mouseout",  function(e,d){ d3.select(this).attr("stroke", d.depth>=3 ? "#999" : "none"); })
          .on("click", (event, d) => {
            if (!d.children) {
              const key    = d.data?.id ?? d.data?.name;
              const record = d.data?.raw;
              setActiveByKey(key);
              localBus.dispatch("waffle:select", { billId: key, title: d.data?.name, record });
              lastSelectedRecord = record || null;
              selectedTitleEl.text(d.data?.name ?? "").datum(lastSelectedRecord);
              event.stopPropagation();
              return;
            }
            if (focus !== d) { zoom(event, d); event.stopPropagation(); }
          })
      )
      .attr("fill", fillColorFor);

    // tooltip
    circles.selectAll("title").remove();
    circles.append("title").text(d => {
      if (!d.children) {
        const raw = d.data?.raw;
        const a = getters.agree(raw) || 0;
        const b = getters.disagree(raw) || 0;
        const p = getters.present(raw) || 0;
        const margin = p ? Math.abs(a-b)/p : 0;
        return `${d.data.name}\npresent: ${p}\nagree: ${a}\ndisagree: ${b}\nmargin: ${(margin*100).toFixed(1)}%`;
      }
      if (d.depth === 1) return displayResultName(d.data?.key ?? d.data?.name) || "";
      return d.data?.name || "";
    });

    const OUT = 10;
    const resultNodes = nodes.filter(d => d.depth === 1);
    const yearNodes   = nodes.filter(d => d.depth === 2);

    gResultLbls.selectAll("text")
      .data(resultNodes, d => d.data.key ?? d.data.name)
      .join("text")
      .attr("text-anchor","middle")
      .style("font","14px Sarabun")
      .style("font-weight","700")
      .style("fill","#333")
      .text(d => displayResultName(d.data.key ?? d.data.name));

    const yearText = gYearLbls.selectAll("text")
      .data(yearNodes, d => d.data.name)
      .join("text")
      .attr("text-anchor","middle")
      .style("font","12px Sarabun")
      .style("font-weight","600")
      .style("fill","#222")
      .style("display","inline")
      .text(d => d.data.name);

    yearText.style("opacity", d => {
      if (!currentYearFilter) return 1;
      return String(d.data?.name) === String(currentYearFilter) ? 1 : 0.35;
    });

    svg.on("click", (event) => zoom(event, root));

    svg.attr("viewBox", `${-W/2} ${-H/2} ${W} ${H}`);
    zoomTo([focus.x, focus.y, focus.r * 2]);

    function positionAll(v) {
      const k = W / v[2];

      gCircles.selectAll("circle")
        .attr("transform", d => `translate(${(d.x - v[0]) * k}, ${(d.y - v[1]) * k})`)
        .attr("r", d => d.r * k);

      gResultLbls.selectAll("text")
        .attr("transform", d => {
          const x = (d.x - v[0]) * k;
          const y = (d.y - v[1]) * k - d.r * k - OUT;
          return `translate(${x},${y})`;
        })
        .style("display", () => (focus === root ? "inline" : "none"));

      gYearLbls.selectAll("text")
        .attr("transform", d => {
          const x = (d.x - v[0]) * k;
          const y = (d.y - v[1]) * k - d.r * k - OUT;
          return `translate(${x},${y})`;
        })
        .style("display","inline")
        .style("opacity", d => {
          if (!currentYearFilter) return 1;
          return String(d.data?.name) === String(currentYearFilter) ? 1 : 0.35;
        });
    }

    function zoomTo(v) { view = v; positionAll(v); }
  }

  /* ---------------- Zoom ---------------- */
  function zoom(event, d) {
    const transition = svg.transition()
      .duration(event?.altKey ? 7500 : 750)
      .tween("zoom", () => {
        const i = d3.interpolateZoom(view, [d.x, d.y, d.r * 2]);
        return t => {
          const v = i(t);
          view = v;
          const k = W / v[2];
          const OUT = 10;

          gCircles.selectAll("circle")
            .attr("transform", n => `translate(${(n.x - v[0]) * k}, ${(n.y - v[1]) * k})`)
            .attr("r", n => n.r * k);

          gResultLbls.selectAll("text")
            .attr("transform", n => {
              const x = (n.x - v[0]) * k;
              const y = (n.y - v[1]) * k - n.r * k - OUT;
              return `translate(${x},${y})`;
            })
            .style("display", () => (d === root ? "inline" : "none"));

          gYearLbls.selectAll("text")
            .attr("transform", n => {
              const x = (n.x - v[0]) * k;
              const y = (n.y - v[1]) * k - n.r * k - OUT;
              return `translate(${x},${y})`;
            })
            .style("display","inline")
            .style("opacity", n => {
              if (!currentYearFilter) return 1;
              return String(n.data?.name) === String(currentYearFilter) ? 1 : 0.35;
            });
        };
      });
    focus = d;
  }

  /* ---------------- Public API & Event wiring ---------------- */
  function update(records) {
    allRecords = records;
    applyResize(true);
  }

  function setActiveByKey(key) {
    selectedKey = key ?? null;
    selectedNode = selectedKey
      ? (byId.get(String(selectedKey)) ?? byTitle.get(String(selectedKey)) ?? null)
      : null;
    gCircles.selectAll("circle").attr("fill", fillColorFor);

    const nameForLabel =
      selectedNode?.data?.name ??
      (selectedKey != null ? String(selectedKey) : "");
    lastSelectedRecord = selectedNode?.data?.raw ?? lastSelectedRecord ?? null;
    selectedTitleEl.text(nameForLabel || "").datum(lastSelectedRecord || null);
  }

  const localBus = bus ?? createMiniBus();

  localBus.on?.("waffle:select", ({ billId, title, record }) => {
    const key = billId ?? title;
    setActiveByKey(key);
    lastSelectedRecord = record || lastSelectedRecord || null;
    selectedTitleEl.text(title ?? String(key) ?? "").datum(lastSelectedRecord || null);
  });

  localBus.on?.("waffle:clear", () => {
    setActiveByKey(null);
    lastSelectedRecord = null;
    selectedTitleEl.text("").datum(null);
  });

  localBus.on?.("year:filterChanged", (y) => {
    currentYearFilter = (y == null || y === "" ? null : String(y));
    gCircles.selectAll("circle").attr("fill", fillColorFor);
    gYearLbls.selectAll("text").style("opacity", d => {
      if (!currentYearFilter) return 1;
      return String(d.data?.name) === String(currentYearFilter) ? 1 : 0.35;
    });
  });

  // Resize
  let ro;
  function applyResize(forceRender = false) {
    const size = getContainerSize();
    if (!forceRender && size.W === W && size.H === H) return;
    W = size.W; H = size.H;
    svg.attr("viewBox", `${-W/2} ${-H/2} ${W} ${H}`);
    render();
  }

  const selfTarget = container.node();
  if (selfTarget) {
    ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => applyResize());
    });
    ro.observe(selfTarget);
  }

  // Initial draw
  render();

  function destroy() {
    if (ro) ro.disconnect();
    container.selectAll("*").remove();
    byId.clear(); byTitle.clear();
    selectedKey = null; selectedNode = null;
  }

  return { update, setActive: setActiveByKey, destroy, bus: localBus, resizeNow: applyResize };
}

/* ---------------- Mini Event Bus ---------------- */
function createMiniBus() {
  const map = new Map();
  return {
    on(evt, fn){ map.set(evt, (map.get(evt)||[]).concat(fn)); },
    dispatch(evt, payload){ (map.get(evt)||[]).forEach(fn => fn(payload)); },
  };
}
