/* =====================================================
   Lifeline – map.js (Enhanced Interactive Map)
   - Fixes page-scroll hijack (scrollWheelZoom off until map is clicked)
   - Modern CartoDB Voyager tiles + Street/Dark switcher
   - Pulsing SOS markers & blood-group badge pins
   - Live floating counter overlay
   ===================================================== */

let mapInstance = null;
let donorLayer = null;
let requestLayer = null;
let lastBounds = null;
let mapOverlayEl = null;

// Default center (India) if no markers have coordinates yet
const DEFAULT_CENTER = [20.5937, 78.9629];
const DEFAULT_ZOOM = 5;

/**
 * Inject scoped CSS animations & badge styles for the map
 * so map.js stays self-contained and impressive.
 */
function injectMapStyles() {
  if (document.getElementById("lifeline-map-styles")) return;

  const style = document.createElement("style");
  style.id = "lifeline-map-styles";
  style.textContent = `
    .lifeline-pin-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .lifeline-pin {
      min-width: 32px;
      height: 26px;
      padding: 0 7px;
      border-radius: 999px;
      color: #ffffff;
      font-family: 'Figtree', system-ui, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 2.5px solid #ffffff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
      transition: transform 0.15s ease;
    }
    .lifeline-pin:hover {
      transform: scale(1.12);
    }
    .lifeline-pin.donor {
      background: linear-gradient(135deg, #16a34a, #15803d);
    }
    .lifeline-pin.request {
      background: linear-gradient(135deg, #ef4444, #b91c1c);
    }
    .lifeline-pulse-ring {
      position: absolute;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(220, 38, 38, 0.38);
      animation: lifeline-pulse 1.8s ease-out infinite;
      pointer-events: none;
    }
    @keyframes lifeline-pulse {
      0% { transform: scale(0.75); opacity: 0.85; }
      70% { transform: scale(1.65); opacity: 0; }
      100% { transform: scale(1.65); opacity: 0; }
    }
    .lifeline-map-hud {
      position: absolute;
      bottom: 12px;
      left: 12px;
      z-index: 500;
      background: rgba(15, 23, 42, 0.82);
      backdrop-filter: blur(8px);
      color: #f8fafc;
      padding: 7px 12px;
      border-radius: 999px;
      font-family: 'Figtree', system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
      pointer-events: none;
    }
    .lifeline-map-hud .hud-sep {
      opacity: 0.4;
    }
    .lifeline-map-hud .hud-hint {
      color: #cbd5e1;
      font-size: 11px;
    }
    .lifeline-popup {
      font-family: 'Figtree', system-ui, sans-serif;
      min-width: 190px;
      line-height: 1.45;
    }
    .lifeline-popup-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
    }
    .lifeline-popup-badge.donor { background: #16a34a; }
    .lifeline-popup-badge.request { background: #dc2626; }
  `;
  document.head.appendChild(style);
}

/**
 * Create a modern blood-group pill marker icon.
 * Green = available donor, Red + pulsing ring = open emergency request.
 */
function createBloodPinIcon(type, bloodGroup) {
  const label = escapeHtml(bloodGroup || "?");
  const pulseHtml = type === "request" ? '<span class="lifeline-pulse-ring"></span>' : "";

  return L.divIcon({
    className: "custom-map-pin",
    html: `
      <div class="lifeline-pin-wrap">
        ${pulseHtml}
        <div class="lifeline-pin ${type}">${label}</div>
      </div>
    `,
    iconSize: [36, 28],
    iconAnchor: [18, 14],
    popupAnchor: [0, -14]
  });
}

/**
 * Initialize the Leaflet map inside <div id="map">.
 * Disables scrollWheelZoom by default so scrolling the webpage stays smooth!
 */
function initMap() {
  if (typeof L === "undefined") {
    console.error("Leaflet library failed to load. Check your internet connection.");
    return;
  }

  injectMapStyles();

  // scrollWheelZoom: false prevents the map from zooming when user scrolls the page
  mapInstance = L.map("map", {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    scrollWheelZoom: false,
    zoomControl: true
  });

  // Clean, modern map themes (no API key needed)
  const voyagerLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap &copy; CARTO"
    }
  );

  const osmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  );

  const darkLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap &copy; CARTO"
    }
  );

  voyagerLayer.addTo(mapInstance);

  // Allow user to switch map styles cleanly
  L.control.layers(
    {
      "Modern Street": voyagerLayer,
      "Classic OSM": osmLayer,
      "Night Mode": darkLayer
    },
    null,
    { position: "topright" }
  ).addTo(mapInstance);

  donorLayer = L.layerGroup().addTo(mapInstance);
  requestLayer = L.layerGroup().addTo(mapInstance);

  // Floating HUD overlay inside the map container
  const mapEl = document.getElementById("map");
  if (mapEl) {
    mapEl.style.position = "relative";
    mapOverlayEl = document.createElement("div");
    mapOverlayEl.className = "lifeline-map-hud";
    mapOverlayEl.innerHTML = `
      <span id="hudCounts">🟢 0 Donors · 🔴 0 Requests</span>
      <span class="hud-sep">|</span>
      <span id="hudZoomHint" class="hud-hint">Click map to scroll-zoom</span>
    `;
    mapEl.appendChild(mapOverlayEl);
  }

  // Enable scroll-wheel zoom ONLY when user clicks inside the map,
  // and turn it back off when their mouse leaves the map!
  mapInstance.on("click", () => {
    if (!mapInstance.scrollWheelZoom.enabled()) {
      mapInstance.scrollWheelZoom.enable();
      const hint = document.getElementById("hudZoomHint");
      if (hint) hint.textContent = "Scroll-zoom active";
    }
  });

  mapInstance.on("mouseout", () => {
    if (mapInstance.scrollWheelZoom.enabled()) {
      mapInstance.scrollWheelZoom.disable();
      const hint = document.getElementById("hudZoomHint");
      if (hint) hint.textContent = "Click map to scroll-zoom";
    }
  });
}

/**
 * Clear old markers and draw fresh green donor + red request markers.
 */
function updateMapMarkers(donors, requests) {
  if (!mapInstance || !donorLayer || !requestLayer) return;

  donorLayer.clearLayers();
  requestLayer.clearLayers();

  const bounds = [];
  let donorPinCount = 0;
  let requestPinCount = 0;

  // 1. Add GREEN markers for available donors
  (donors || []).forEach((donor) => {
    const lat = parseFloat(donor.latitude);
    const lng = parseFloat(donor.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const icon = createBloodPinIcon("donor", donor.blood_group);
    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(`
      <div class="lifeline-popup">
        <span class="lifeline-popup-badge donor">DONOR · ${escapeHtml(donor.blood_group || "N/A")}</span><br/>
        <strong>${escapeHtml(donor.name || "Donor")}</strong><br/>
        Area: ${escapeHtml(donor.area || "N/A")}<br/>
        Contact: ${escapeHtml(donor.contact_preference || "N/A")}
      </div>
    `);
    marker.addTo(donorLayer);
    bounds.push([lat, lng]);
    donorPinCount += 1;
  });

  // 2. Add RED pulsing markers for open emergency requests
  (requests || []).forEach((req) => {
    const status = String(req.status || "open").toLowerCase();
    if (status === "closed" || status === "fulfilled") return;

    const lat = parseFloat(req.latitude);
    const lng = parseFloat(req.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const icon = createBloodPinIcon("request", req.blood_group);
    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(`
      <div class="lifeline-popup">
        <span class="lifeline-popup-badge request">EMERGENCY · ${escapeHtml(req.blood_group || "N/A")}</span><br/>
        <strong>${escapeHtml(req.hospital || "Hospital")}</strong><br/>
        Area: ${escapeHtml(req.area || "N/A")}<br/>
        Units Needed: <strong>${escapeHtml(String(req.units_needed || 1))}</strong><br/>
        Contact: ${escapeHtml(req.contact || "N/A")}
      </div>
    `);
    marker.addTo(requestLayer);
    bounds.push([lat, lng]);
    requestPinCount += 1;
  });

  // Update floating HUD counts
  const hudCounts = document.getElementById("hudCounts");
  if (hudCounts) {
    hudCounts.textContent = `🟢 ${donorPinCount} Donors · 🔴 ${requestPinCount} Active SOS`;
  }

  lastBounds = bounds.length > 0 ? bounds : null;

  // Auto-zoom map to fit all visible markers
  if (lastBounds) {
    mapInstance.fitBounds(lastBounds, { padding: [45, 45], maxZoom: 13 });
  }
}

/**
 * Recenter the map cleanly to active pins (or default view if none).
 */
function recenterMap() {
  if (!mapInstance) return;
  if (lastBounds && lastBounds.length > 0) {
    mapInstance.fitBounds(lastBounds, { padding: [45, 45], maxZoom: 13 });
  } else {
    mapInstance.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }
}

/**
 * Fix Leaflet gray tiles when map container is shown after being hidden in a tab.
 */
function refreshMapSize() {
  if (!mapInstance) return;
  setTimeout(() => {
    mapInstance.invalidateSize();
    if (lastBounds && lastBounds.length > 0) {
      mapInstance.fitBounds(lastBounds, { padding: [45, 45], maxZoom: 13 });
    }
  }, 120);
}

/**
 * Simple helper to prevent HTML injection in map popups.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
