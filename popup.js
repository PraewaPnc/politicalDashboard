// popup.js
export function createDetailsPopup(containerSelector, eventBus) {
  const container = d3.select(containerSelector);
  container.html(""); // Clear the container

  // Create the dark overlay/modal backdrop
  const overlay = container
    .append("div")
    .attr("class", "popup-overlay")
    .on("click", () => {
      // Close popup when clicking outside (on the overlay)
      overlay.style("display", "none");
    });

  // Create the main modal box
  const modal = overlay
    .append("div")
    .attr("class", "popup-box")
    // Stop propagation so clicking the box doesn't close the modal
    .on("click", (event) => event.stopPropagation()); 

  // Add close button (moved to header for better structure)
  const header = modal.append("div").attr("class", "popup-header");
  
  const title = header.append("h3").attr("id", "popup-title");

  header
    .append("button")
    .attr("class", "popup-close-btn")
    .html("×")
    .on("click", () => {
      overlay.style("display", "none");
    });
    
  // --- Content Body ---
  const body = modal.append("div").attr("class", "popup-body");
  
  // Date Row
  const dateRow = body.append("div").attr("class", "popup-info-row");
  dateRow.append("span").attr("class", "info-label").text("Start Date:");
  const dateValue = dateRow.append("span").attr("id", "popup-date").attr("class", "info-value");

  // Result Row
  const resultRow = body.append("div").attr("class", "popup-info-row");
  resultRow.append("span").attr("class", "info-label").text("Result:");
  const resultValue = resultRow.append("span").attr("id", "popup-result").attr("class", "info-value result-status");

  // Description Section
  body.append("h4").attr("class", "popup-description-title").text("Description");
  const description = body.append("p").attr("id", "popup-description").attr("class", "popup-description-text");

  // --- Function to show the popup ---
  function showPopup(record) {
    if (!record) return;

    // Populate content
    title.text(record.title || "Untitled Vote Event");
    
    // Set Date
    dateValue.text(record.dateStr || 'N/A');
    
    // Set Result and add status class for visual distinction
    const resultText = record.result || 'N/A';
    resultValue
      .text(resultText)
      .classed("status-passed", resultText.toLowerCase().includes("passed"))
      .classed("status-failed", resultText.toLowerCase().includes("failed"));
    
    // Simple text for description (handle potential null/undefined)
    description.text(record.description || "No detailed description provided for this vote event.");

    // Show the overlay
    overlay.style("display", "flex");
  }

  // --- Event Listener ---
  eventBus.on("details:show", showPopup);
  
  // Public API (if needed)
  return { showPopup };
}