// circlePacking.js
// Zoomable circle packing + interaction กับ Waffle/Pie ผ่าน event bus
// - กลุ่มผลโหวต 3 วง: "ผ่าน" / "ไม่ผ่าน" / "N/A"
// - ชั้นถัดไปแยก "ปี"
// - วงในสุด (leaf = 1 พ.ร.บ./เรื่อง) มีขนาดตาม |agree_count - disagree_count|
// - คลิกใบ (leaf): "ไม่ซูม" แต่ไฮไลต์ตัวเอง + ส่งสัญญาณให้ Waffle active (waffle:select)
// - Waffle จะส่งต่อ (waffle:selected) ให้ Pie เปลี่ยนตาม (รูปแบบเดิม)
// - รับ event จาก Waffle เพื่อไฮไลต์ (เทาอย่างอื่น) โดยไม่ซูม
// - รองรับจับคู่ขนาดกับ container อื่น (เช่น waffle) ผ่าน options.matchTo
// - [NEW - YEAR FILTER] เมื่อปีเปลี่ยน จะทำให้ปีที่ถูกเลือกแสดง “สีปกติ” และปีอื่น ๆ เป็น “สีเทา”

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export function createCirclePacking(containerSelector, allRecords, PARTY_COLORS, bus, options = {}) {
  const matchTo    = options.matchTo || null;
  const keepSquare = options.keepSquare ?? true;

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
    agree:    (d) => d?.VoteEvent?.agree_count    ?? d?.agree_count    ?? 0,
    disagree: (d) => d?.VoteEvent?.disagree_count ?? d?.disagree_count ?? 0,
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

  /* ---------------- Build hierarchy: root → result → year → leaf ---------------- */
  function buildHierarchy(records, sizeScale) {
    const byResult = new Map([[PASS, new Map()], [FAIL, new Map()], [NA, new Map()]]);
    for (const r of records) {
      const res   = normalizeResult(getters.result(r));
      const yr    = getters.year(r);
      const title = getters.title(r);
      const id    = getters.id(r);
      const diff  = Math.abs((+getters.agree(r) || 0) - (+getters.disagree(r) || 0));
      const weight = sizeScale ? sizeScale(diff) : 1;

      if (!byResult.get(res).has(yr)) byResult.get(res).set(yr, []);
      byResult.get(res).get(yr).push({ name: title, id, value: weight, raw: r, diff });
    }

    const resultChildren = [];
    for (const [resName, byYear] of byResult.entries()) {
      const years = Array.from(byYear.keys()).sort((a,b)=>{
        const na=+a, nb=+b;
        if (!isNaN(na) && !isNaN(nb)) return nb - na; // ปีใหม่ก่อน
        return String(b).localeCompare(String(a));
      });
      resultChildren.push({ name: resName, children: years.map(y => ({ name: String(y), children: byYear.get(y) })) });
    }
    return { name: "Votes", children: resultChildren };
  }

  /* ---------------- Colors ---------------- */
  const COLOR_RESULT = { [PASS]: "#cfdd9d", [FAIL]: "#f8cae4", [NA]: "#e0e0e0" }; // ชั้นผลโหวต (depth 1)
  const COLOR_YEAR   = { [PASS]: "#a5c4a8", [FAIL]: "#ea6993", [NA]: "#b0b0b0" }; // ชั้นปี (depth 2)
  const COLOR_LEAF   = { [PASS]: "#447a5f", [FAIL]: "#832d51", [NA]: "#7f7f7f" }; // ใบ
  const GREY_LIGHT   = "#e6e6e6";
  const GREY_LEAF    = "#c9c9c9";
  const GREY_YEAR    = "#d8d8d8"; // [NEW - YEAR FILTER] สีเทาสำหรับวงปีที่ไม่ใช่ปีที่เลือก

  /* ---------------- Container & Size ---------------- */
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  function getTargetSize() {
    let w, h;
    const refEl = matchTo ? document.querySelector(matchTo) : container.node();
    const rect = refEl?.getBoundingClientRect?.();
    if (rect && rect.width && rect.height) { w = rect.width; h = rect.height; }
    else { w = container.node().clientWidth || 928; h = container.node().clientHeight || w; }
    if (keepSquare) { const m = Math.min(w, h || w); return { W: m, H: m }; }
    return { W: w, H: h || w };
  }
  let { W, H } = getTargetSize();

  const svg = container.append("svg")
    .attr("width", W).attr("height", H)
    .attr("viewBox", `${-W/2} ${-H/2} ${W} ${H}`)
    .style("display","block").style("cursor","pointer");

  const gCircles    = svg.append("g");
  const gResultLbls = svg.append("g").attr("pointer-events","none");
  const gYearLbls   = svg.append("g").attr("pointer-events","none");

  /* ---------------- State ---------------- */
  let root, focus, view;
  const byId = new Map(), byTitle = new Map();
  let selectedKey = null;
  let selectedNode = null;
  let currentYearFilter = null; // [NEW - YEAR FILTER] ปีที่ถูกเลือก (เช่น "2024"); null = ไม่กรองปี

  /* ---------------- Compute ---------------- */
  function compute(records) {
    const diffs = (records ?? []).map(r => Math.abs((+getters.agree(r) || 0) - (+getters.disagree(r) || 0)));
    const maxDiff = d3.max(diffs) || 0;
    const sizeScale = d3.scaleSqrt().domain([0, maxDiff]).range([1, 30]);

    const data = buildHierarchy(records ?? [], sizeScale);
    root = d3.pack().size([W, H]).padding(3)(
      d3.hierarchy(data).sum(d => d.value || 0).sort((a,b)=>b.value - a.value)
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
  function nodeResultName(n){
    if (!n) return null;
    if (n.depth === 1) return n.data?.name;                    // ผ่าน/ไม่ผ่าน/N/A
    if (n.depth === 2) return n.parent?.data?.name;
    if (n.depth >= 3)  return n.parent?.parent?.data?.name;
    return null;
  }

  function nodeYearName(n) {  // [NEW - YEAR FILTER] คืนชื่อปีของ node
    if (!n) return null;
    if (n.depth === 2) return n.data?.name;            // node วงปี
    if (n.depth >= 3)  return n.parent?.data?.name;    // ใบอยู่ใต้ปี → ปีคือชื่อ parent
    return null;
  }

  function isAncestorOrSelf(a, b) {
    if (!a || !b) return false;
    let x = b;
    while (x) { if (x === a) return true; x = x.parent; }
    return false;
  }

  function fillColorFor(d) {
    const res = nodeResultName(d);

    // [NEW - YEAR FILTER] ถ้ามี year filter → ให้โหนดปีอื่นเป็นสีเทา
    if (currentYearFilter && d.depth >= 2) {
      const y = nodeYearName(d);
      if (String(y) !== String(currentYearFilter)) {
        return d.depth === 2 ? GREY_YEAR : GREY_LEAF;
      }
    }

    // (ส่วนเดิม) ยังไม่มีการเลือกใบ → ใช้สีปกติ
    if (!selectedNode) {
      if (d.depth === 1) return (COLOR_RESULT[d.data.name] ?? GREY_LIGHT);
      if (d.depth === 2) return (COLOR_YEAR[res] ?? GREY_LIGHT);
      return (COLOR_LEAF[res] ?? "white");
    }

    // (ส่วนเดิม) มีใบที่เลือก → แสดงสีเฉพาะ path ของ selected (ผล→ปี→ใบ) ที่เหลือเป็นเทา
    const onPath = isAncestorOrSelf(d, selectedNode);
    if (!onPath) return d.depth >= 3 ? GREY_LEAF : GREY_LIGHT;

    if (d.depth === 1) return (COLOR_RESULT[d.data.name] ?? GREY_LIGHT);
    if (d.depth === 2) return (COLOR_YEAR[res] ?? GREY_LIGHT);
    return (COLOR_LEAF[res] ?? "white");
  }

  /* ---------------- Render ---------------- */
  function render() {
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
              // คลิกใบ: ไม่ซูม / ไฮไลต์ / ส่งเรื่องไปให้ Waffle เลือก
              const key    = d.data?.id ?? d.data?.name;
              const record = d.data?.raw;
              setActiveByKey(key); // ไฮไลต์ใน circle packing
              localBus.dispatch("waffle:select", { billId: key, title: d.data?.name, record }); // สำคัญ
              event.stopPropagation();
              return;
            }
            // Node ภายใน (ผล/ปี) ยังซูมได้ตามปกติ
            if (focus !== d) { zoom(event, d); event.stopPropagation(); }
          })
      )
      .attr("fill", fillColorFor);

    // tooltip ง่าย ๆ
    circles.selectAll("title").remove();
    circles.append("title").text(d => {
      if (!d.children) {
        const raw = d.data?.raw;
        const a = getters.agree(raw) || 0;
        const b = getters.disagree(raw) || 0;
        return `${d.data.name}\nagree: ${a}\ndisagree: ${b}\ndiff: ${Math.abs(a-b)}`;
      }
      return d.data?.name || "";
    });

    // labels (ผล/ปี) อยู่นอกวง
    const OUT = 10;
    const resultNodes = nodes.filter(d => d.depth === 1);
    const yearNodes   = nodes.filter(d => d.depth === 2);

    gResultLbls.selectAll("text")
      .data(resultNodes, d => d.data.name)
      .join("text")
      .attr("text-anchor","middle")
      .style("font","14px sans-serif")
      .style("font-weight","700")
      .style("fill","#333")
      .text(d => d.data.name);

    const yearText = gYearLbls.selectAll("text")
      .data(yearNodes, d => d.data.name)
      .join("text")
      .attr("text-anchor","middle")
      .style("font","12px sans-serif")
      .style("font-weight","600")
      .style("fill","#222")
      .text(d => d.data.name);

    // [UPDATED - YEAR FILTER] จาง label ของปีที่ไม่ได้ถูกเลือก
    yearText.style("opacity", d => {
      if (!currentYearFilter) return 1;
      return String(d.data?.name) === String(currentYearFilter) ? 1 : 0.35;
    });

    svg.on("click", (event) => zoom(event, root));

    svg.attr("width", W).attr("height", H)
       .attr("viewBox", `${-W/2} ${-H/2} ${W} ${H}`);
    zoomTo([focus.x, focus.y, focus.r * 2]);

    function positionAll(v) {
      const k = W / v[2];

      gCircles.selectAll("circle")
        .attr("transform", d => `translate(${(d.x - v[0]) * k}, ${(d.y - v[1]) * k})`)
        .attr("r", d => d.r * k);

      // result labels: โชว์เมื่อ focus=root
      gResultLbls.selectAll("text")
        .attr("transform", d => {
          const x = (d.x - v[0]) * k;
          const y = (d.y - v[1]) * k - d.r * k - OUT;
          return `translate(${x},${y})`;
        })
        .style("display", () => (focus === root ? "inline" : "none"));

      // year labels: โชว์เมื่อ focus เป็น result
      gYearLbls.selectAll("text")
        .attr("transform", d => {
          const x = (d.x - v[0]) * k;
          const y = (d.y - v[1]) * k - d.r * k - OUT;
          return `translate(${x},${y})`;
        })
        .style("display", d => (d.parent === focus ? "inline" : "none"))
        // [UPDATED - YEAR FILTER] รีเฟรช opacity ของ label เมื่อมีการ zoom
        .style("opacity", d => {
          if (!currentYearFilter) return 1;
          return String(d.data?.name) === String(currentYearFilter) ? 1 : 0.35;
        });
    }

    function zoomTo(v) { view = v; positionAll(v); }
  }

  /* ---------------- Zoom (เฉพาะคลิก node ภายใน) ---------------- */
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
            .style("display", n => (n.parent === d ? "inline" : "none"))
            // [UPDATED - YEAR FILTER] รีเฟรช opacity ของ label เมื่อมีการ zoom
            .style("opacity", n => {
              if (!currentYearFilter) return 1;
              return String(n.data?.name) === String(currentYearFilter) ? 1 : 0.35;
            });
        };
      });
    focus = d;
  }

  /* ---------------- Public API & Event wiring ---------------- */
  function update(records) { compute(records ?? allRecords ?? []); render(); }

  function setActiveByKey(key) {
    selectedKey = key ?? null;
    selectedNode = selectedKey
      ? (byId.get(String(selectedKey)) ?? byTitle.get(String(selectedKey)) ?? null)
      : null;
    gCircles.selectAll("circle").attr("fill", fillColorFor);
  }

  const localBus = bus ?? createMiniBus();

  // รับจาก waffle → ไฮไลต์ (ไม่ซูม)
  localBus.on?.("waffle:select", ({ billId, title }) => {
    const key = billId ?? title;
    setActiveByKey(key);
  });
  localBus.on?.("waffle:clear", () => setActiveByKey(null));

  // [NEW - YEAR FILTER] เมื่อปีเปลี่ยน → อัปเดต year filter + repaint สี/label
  localBus.on?.("year:filterChanged", (y) => {
    currentYearFilter = (y == null || y === "" ? null : String(y));
    gCircles.selectAll("circle").attr("fill", fillColorFor);
    // จัดการ label ปีให้จาง/ชัดตามปีที่เลือก
    gYearLbls.selectAll("text").style("opacity", d => {
      if (!currentYearFilter) return 1;
      return String(d.data?.name) === String(currentYearFilter) ? 1 : 0.35;
    });
  });

  // Resize ให้เท่ากับกล่องอ้างอิง
  let ro;
  function applyResize() {
    const size = getTargetSize();
    if (size.W === W && size.H === H) return;
    W = size.W; H = size.H;
    svg.attr("width", W).attr("height", H)
       .attr("viewBox", `${-W/2} ${-H/2} ${W} ${H}`);
    update();
  }
  if (matchTo) {
    const target = document.querySelector(matchTo);
    if (target) { ro = new ResizeObserver(applyResize); ro.observe(target); }
  } else {
    const selfTarget = container.node();
    if (selfTarget) { ro = new ResizeObserver(applyResize); ro.observe(selfTarget); }
  }

  update(allRecords);

  function destroy() {
    if (ro) ro.disconnect();
    container.selectAll("*").remove();
    byId.clear(); byTitle.clear();
    selectedKey = null; selectedNode = null;
  }

  return { update, setActive: setActiveByKey, destroy, bus: localBus, resizeNow: applyResize };
}

/* ---------------- Mini Event Bus (กรณีไม่ส่ง bus เข้ามา) ---------------- */
function createMiniBus() {
  const map = new Map();
  return {
    on(evt, fn){ map.set(evt, (map.get(evt)||[]).concat(fn)); },
    dispatch(evt, payload){ (map.get(evt)||[]).forEach(fn => fn(payload)); },
  };
}
