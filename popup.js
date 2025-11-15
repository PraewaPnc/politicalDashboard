export function createDetailsPopup(containerSelector, eventBus) {
  const container = d3.select(containerSelector);
  container.html(""); // Clear the container

  let currentPartyFilter = "all"; // 💡 เพิ่มตัวแปร filter

  const overlay = container
    .append("div")
    .attr("class", "popup-overlay")
    .on("click", () => {
      overlay.style("display", "none");
    });

  const modal = overlay
    .append("div")
    .attr("class", "popup-box")
    .on("click", (event) => event.stopPropagation());

  const header = modal.append("div").attr("class", "popup-header");
  const title = header.append("h3").attr("id", "popup-title");

  header
    .append("button")
    .attr("class", "popup-close-btn")
    .html("×")
    .on("click", () => {
      overlay.style("display", "none");
    });

  const body = modal.append("div").attr("class", "popup-body");

  const dateRow = body.append("div").attr("class", "popup-info-row");
  dateRow.append("span").attr("class", "info-label").text("วันที่ลงมติ:");
  const dateValue = dateRow.append("span").attr("id", "popup-date").attr("class", "info-value");

  const resultRow = body.append("div").attr("class", "popup-info-row");
  resultRow.append("span").attr("class", "info-label").text("สรุปผลการพิจารณา:");
  const resultValue = resultRow.append("span").attr("id", "popup-result").attr("class", "info-value result-status");

  // ✅ NEW: สัดส่วนการเข้าร่วม
  const presentRow = body.append("div").attr("class", "popup-info-row");
  presentRow.append("span").attr("class", "info-label").text("จำนวนผู้เข้าร่วมประชุม:");
  const presentValue = presentRow.append("span").attr("id", "popup-present").attr("class", "info-value");

  // Description
  body.append("h4").attr("class", "popup-description-title").text("รายละเอียด");
  const description = body.append("p").attr("id", "popup-description").attr("class", "popup-description-text");

  function showPopup(record) {
    if (!record) return;

    title.text(record.title || "Untitled Vote Event");
    dateValue.text(record.dateStr || 'N/A');

    const resultText = record.result || 'N/A';
    resultValue
      .text(resultText)
      .classed("status-passed", resultText.toLowerCase().includes("passed"))
      .classed("status-failed", resultText.toLowerCase().includes("failed"));

    description.text(record.description || "No detailed description provided for this vote event.");

    // ✅ NEW: Show Present Percent ตามพรรคที่เลือก
    let partyPresent = record.presentCount;
    let partyTotal = record.totalVoters;

    if (currentPartyFilter !== "all") {
      const partyKey = currentPartyFilter.trim().toLowerCase();
      const breakdown = record.partyBreakdown || {};
      const totals = record.totalByParty || {};

      partyPresent = breakdown[partyKey] || 0;
      partyTotal = totals[partyKey] || 0;
    }

    const percent = partyTotal ? ((partyPresent / partyTotal) * 100).toFixed(1) : "0.0";
    presentValue.text(`${partyPresent}/${partyTotal} (${percent}%)`);

    overlay.style("display", "flex");
  }

  // ✅ รับ event ตอนเปลี่ยน party filter
  eventBus.on("party:filterChanged", (partyName) => {
    currentPartyFilter = (partyName || "all").trim().toLowerCase();
  });

  eventBus.on("details:show", showPopup);

  return { showPopup };
}
