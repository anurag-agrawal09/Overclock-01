/* =====================================================
   Lifeline – map.js (Leaflet OpenStreetMap integration)
   Shows GREEN markers for donors & RED markers for requests
   ===================================================== */

let mapInstance = null;
let donorLayer = null;
let requestLayer = null;

// Default center (India) if no markers have coordinates yet
const DEFAULT_CENTER = [20.5937, 78.9629];
const DEFAULT_ZOOM = 5;

/**
 * Create a colored circle marker icon using Leaflet divIcon.
 * Green = available donor, Red = open emergency request.
 */
function createPinIcon(color) {
  return L.divIcon({
    className: "custom-map-pin",
    html: `<div style="
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: ${color};
      border: 3px solid #ffffff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

const GREEN_DONOR_ICON = createPinIcon("#16a34a");
const RED_REQUEST_ICON = createPinIcon("#dc2626");

/**
 * Initialize the Leaflet map inside <div id="map">.
 */
function initMap() {
  if (typeof L === "undefined") {
    console.error("Leaflet library failed to load. Check your internet connection.");
    return;
  }

  mapInstance = L.map("map").setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  // Free OpenStreetMap tiles (no API key required)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(mapInstance);

  donorLayer = L.layerGroup().addTo(mapInstance);
  requestLayer = L.layerGroup().addTo(mapInstance);
}

/**
 * Clear old markers and draw fresh green donor + red request markers.
 */
function updateMapMarkers(donors, requests) {
  if (!mapInstance || !donorLayer || !requestLayer) return;

  donorLayer.clearLayers();
  requestLayer.clearLayers();

  const bounds = [];

  // 1. Add GREEN markers for available donors
  (donors || []).forEach((donor) => {
    const lat = parseFloat(donor.latitude);
    const lng = parseFloat(donor.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = L.marker([lat, lng], { icon: GREEN_DONOR_ICON });
    marker.bindPopup(`
      <strong>🩸 Donor: ${escapeHtml(donor.blood_group || "N/A")}</strong><br/>
      Name: ${escapeHtml(donor.name || "Donor")}<br/>
      Area: ${escapeHtml(donor.area || "N/A")}<br/>
      Contact: ${escapeHtml(donor.contact_preference || "N/A")}
    `);
    marker.addTo(donorLayer);
    bounds.push([lat, lng]);
  });

  // 2. Add RED markers for open emergency requests
  (requests || []).forEach((req) => {
    const status = String(req.status || "open").toLowerCase();
    if (status === "closed" || status === "fulfilled") return;

    const lat = parseFloat(req.latitude);
    const lng = parseFloat(req.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = L.marker([lat, lng], { icon: RED_REQUEST_ICON });
    marker.bindPopup(`
      <strong>🚨 Emergency: ${escapeHtml(req.blood_group || "N/A")}</strong><br/>
      Hospital: ${escapeHtml(req.hospital || "N/A")}<br/>
      Area: ${escapeHtml(req.area || "N/A")}<br/>
      Units Needed: ${escapeHtml(String(req.units_needed || 1))}<br/>
      Contact: ${escapeHtml(req.contact || "N/A")}
    `);
    marker.addTo(requestLayer);
    bounds.push([lat, lng]);
  });

  // Auto-zoom map to fit all visible markers
  if (bounds.length > 0) {
    mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }
}

/**
 * Recenter the map back to default view.
 */
function recenterMap() {
  if (!mapInstance) return;
  mapInstance.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
}

/**
 * Simple helper to prevent HTML injection in map popups.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
