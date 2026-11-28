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
let userLayer = null;
let lastBounds = null;
let mapOverlayEl = null;

// Area coordinates dictionary for smart location inference
const AREA_COORDINATES = {
  "hazratganj": [26.8532, 80.9463],
  "gomti nagar": [26.8537, 80.9992],
  "aliganj": [26.8920, 80.9416],
  "indira nagar": [26.8797, 80.9882],
  "aminabad": [26.8448, 80.9259],
  "charbagh": [26.8289, 80.9213],
  "chowk": [26.8687, 80.9022],
  "rajajipuram": [26.8375, 80.8872],
  "mahanagar": [26.8732, 80.9525],
  "lucknow": [26.8467, 80.9462],
  "delhi": [28.6139, 77.2090],
  "mumbai": [19.0760, 72.8777],
  "kanpur": [26.4499, 80.3319],
  "varanasi": [25.3176, 82.9739],
  "agra": [27.1767, 78.0081]
};

function inferCoordsFromText(text) {
  if (!text) return [26.8467, 80.9462];
  const lower = String(text).toLowerCase();
  for (const [key, coords] of Object.entries(AREA_COORDINATES)) {
    if (lower.includes(key)) {
      return [coords[0] + (Math.random() - 0.5) * 0.005, coords[1] + (Math.random() - 0.5) * 0.005];
    }
  }
  return [26.8467 + (Math.random() - 0.5) * 0.008, 80.9462 + (Math.random() - 0.5) * 0.008];
}

// Default center (India) if no markers have coordinates yet
const DEFAULT_CENTER = [22.5937, 78.9629];
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
      min-width: 38px;
      height: 28px;
      padding: 0 8px;
      border-radius: 999px;
      color: #ffffff;
      font-family: 'Figtree', system-ui, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      border: 2px solid #ffffff;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      transition: transform 0.15s ease;
      white-space: nowrap;
    }
    .lifeline-pin:hover {
      transform: scale(1.15);
      z-index: 999;
    }
    .lifeline-pin.donor {
      background: linear-gradient(135deg, #16a34a, #15803d);
    }
    .lifeline-pin.request {
      background: linear-gradient(135deg, #ef4444, #b91c1c);
    }
    .lifeline-pin.user {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      border: 2.5px solid #93c5fd;
      box-shadow: 0 0 16px rgba(37, 99, 235, 0.65);
    }
    .lifeline-pin.matched {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border: 2.5px solid #fef08a;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.7);
    }
    .lifeline-pulse-ring {
      position: absolute;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: rgba(220, 38, 38, 0.45);
      animation: lifeline-pulse 1.8s ease-out infinite;
      pointer-events: none;
    }
    .user-pulse-ring {
      position: absolute;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: rgba(37, 99, 235, 0.4);
      animation: lifeline-pulse 2s ease-out infinite;
      pointer-events: none;
    }
    .gold-pulse-ring {
      position: absolute;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(245, 158, 11, 0.45);
      animation: lifeline-pulse 1.6s ease-out infinite;
      pointer-events: none;
    }
    @keyframes lifeline-pulse {
      0% { transform: scale(0.75); opacity: 0.9; }
      70% { transform: scale(1.75); opacity: 0; }
      100% { transform: scale(1.75); opacity: 0; }
    }
    .lifeline-map-hud {
      position: absolute;
      bottom: 12px;
      left: 12px;
      z-index: 500;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(10px);
      color: #f8fafc;
      padding: 6px 14px;
      border-radius: 999px;
      font-family: 'Figtree', system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      pointer-events: auto;
    }
    .lifeline-map-hud .hud-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .lifeline-map-hud .hud-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .lifeline-map-hud .hud-dot.user { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; }
    .lifeline-map-hud .hud-dot.request { background: #ef4444; box-shadow: 0 0 6px #ef4444; }
    .lifeline-map-hud .hud-dot.matched { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
    .lifeline-map-hud .hud-dot.donor { background: #10b981; }
    .lifeline-map-hud .hud-sep {
      opacity: 0.35;
    }
    .lifeline-map-hud .hud-hint {
      color: #94a3b8;
      font-size: 11px;
    }
    .lifeline-popup {
      font-family: 'Figtree', system-ui, sans-serif;
      min-width: 200px;
      line-height: 1.5;
    }
    .lifeline-popup-badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      color: #fff;
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .lifeline-popup-badge.donor { background: #16a34a; }
    .lifeline-popup-badge.request { background: #dc2626; }
    .lifeline-popup-badge.user { background: #2563eb; }
    .lifeline-popup-badge.matched { background: #d97706; }
  `;
  document.head.appendChild(style);
}

/**
 * Create a modern blood-group pill marker icon.
 * - 'user': Blue glowing pin with 👤 YOU and blue pulse
 * - 'request': Red emergency pin with 🚨 NEED and alert pulse
 * - 'matched': Gold hero pin with ⭐ READY and golden halo
 * - 'donor': Green pin with 🩸 DONOR
 */
function createBloodPinIcon(type, bloodGroup, customText = null) {
  let pulseHtml = "";
  let label = "";

  if (type === "user") {
    pulseHtml = '<span class="user-pulse-ring"></span>';
    label = '<span>👤</span> <span>YOU</span>';
  } else if (type === "matched") {
    pulseHtml = '<span class="gold-pulse-ring"></span>';
    const bg = escapeHtml(bloodGroup || "READY");
    label = `<span>⭐</span> <span>${bg} READY</span>`;
  } else if (type === "request") {
    pulseHtml = '<span class="lifeline-pulse-ring"></span>';
    const bg = escapeHtml(bloodGroup || "SOS");
    label = `<span>🚨</span> <span>${bg} NEED</span>`;
  } else {
    // Regular donor
    const bg = escapeHtml(bloodGroup || "DONOR");
    label = `<span>🩸</span> <span>${bg}</span>`;
  }

  if (customText) {
    label = escapeHtml(customText);
  }

  return L.divIcon({
    className: "custom-map-pin",
    html: `
      <div class="lifeline-pin-wrap">
        ${pulseHtml}
        <div class="lifeline-pin ${type}">${label}</div>
      </div>
    `,
    iconSize: [44, 30],
    iconAnchor: [22, 15],
    popupAnchor: [0, -15]
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

  userLayer = L.layerGroup().addTo(mapInstance);
  donorLayer = L.layerGroup().addTo(mapInstance);
  requestLayer = L.layerGroup().addTo(mapInstance);

  // Floating HUD overlay inside the map container
  const mapEl = document.getElementById("map");
  if (mapEl) {
    mapEl.style.position = "relative";
    mapOverlayEl = document.createElement("div");
    mapOverlayEl.className = "lifeline-map-hud";
    mapOverlayEl.innerHTML = `
      <span class="hud-item"><span class="hud-dot user"></span> 👤 You</span>
      <span class="hud-item"><span class="hud-dot request"></span> 🚨 Needs Blood</span>
      <span class="hud-item"><span class="hud-dot matched"></span> ⭐ Ready to Donate</span>
      <span class="hud-item"><span class="hud-dot donor"></span> 🩸 Donor</span>
      <span class="hud-sep">|</span>
      <span id="hudCounts">0 Donors · 0 SOS</span>
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
 * Clear old markers and draw:
 * 1. Current user location (special glowing blue pin)
 * 2. Nearby people who need blood (crimson pulsing pin)
 * 3. Donors ready/matched to donate to user (gold glowing star pin)
 * 4. Other verified available donors (emerald green blood pin)
 */
function updateMapMarkers(donors, requests, isHospitalView = false, activeUser = null, alerts = []) {
  if (!mapInstance || !donorLayer || !requestLayer) return;

  if (userLayer) userLayer.clearLayers();
  donorLayer.clearLayers();
  requestLayer.clearLayers();

  const bounds = [];
  let donorPinCount = 0;
  let requestPinCount = 0;
  let matchedPinCount = 0;

  // 1. Add Current User Special Marker
  if (activeUser && activeUser.name) {
    let uLat = parseFloat(activeUser.latitude);
    let uLng = parseFloat(activeUser.longitude);

    if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) {
      const areaText = activeUser.area || activeUser.info || activeUser.name;
      const inferred = inferCoordsFromText(areaText);
      uLat = inferred[0];
      uLng = inferred[1];
    }

    const userIcon = createBloodPinIcon("user", "YOU");
    const userMarker = L.marker([uLat, uLng], { icon: userIcon, zIndexOffset: 1500 });
    userMarker.bindPopup(`
      <div class="lifeline-popup">
        <span class="lifeline-popup-badge user">👤 YOUR LOCATION</span><br/>
        <strong>${escapeHtml(activeUser.name || "You")}</strong><br/>
        <span>${escapeHtml(activeUser.info || "Active LifeLink Member")}</span><br/>
        <small style="color:#64748b;">(Special Detected User Pin)</small>
      </div>
    `);
    if (userLayer) userMarker.addTo(userLayer);
    bounds.push([uLat, uLng]);
  }

  // 2. Identify donors who are ready to donate to the user
  const readyDonorNames = new Set();
  (alerts || []).forEach((a) => {
    const msg = (a.message || "").toLowerCase();
    if (msg.includes("ready to donate") || msg.includes("i am ready") || msg.includes("accepted")) {
      if (a.donor_name) readyDonorNames.add(a.donor_name.toLowerCase().trim());
    }
  });

  // 3. Add Donors (Golden star for 'Ready to Donate', Green for available donors)
  (donors || []).forEach((donor) => {
    let lat = parseFloat(donor.latitude);
    let lng = parseFloat(donor.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const inferred = inferCoordsFromText(donor.area || donor.name);
      lat = inferred[0];
      lng = inferred[1];
    }

    const dName = (donor.name || "").toLowerCase().trim();
    const isReadyMatched = readyDonorNames.has(dName) || donor.is_ready === true || donor.status === "ready";

    if (isReadyMatched) {
      const icon = createBloodPinIcon("matched", donor.blood_group);
      const marker = L.marker([lat, lng], { icon, zIndexOffset: 1200 });
      marker.bindPopup(`
        <div class="lifeline-popup">
          <span class="lifeline-popup-badge matched">⭐ HERO DONOR READY</span><br/>
          <strong>${escapeHtml(donor.name || "Hero Donor")}</strong><br/>
          <span style="color:#d97706;font-weight:700;">Ready to Donate Blood to You!</span><br/>
          Area: ${escapeHtml(donor.area || "Nearby Area")}<br/>
          Contact: <strong>${escapeHtml(donor.contact_preference || "Direct LifeLink Alert")}</strong>
        </div>
      `);
      marker.addTo(donorLayer);
      bounds.push([lat, lng]);
      matchedPinCount += 1;
    } else {
      const icon = createBloodPinIcon("donor", donor.blood_group);
      const marker = L.marker([lat, lng], { icon });

      const popupDetails = isHospitalView
        ? `<strong>${escapeHtml(donor.name || "Donor")}</strong><br/>
           Area: ${escapeHtml(donor.area || "N/A")}<br/>
           Contact: ${escapeHtml(donor.contact_preference || "N/A")}`
        : `<strong>Verified Eligible Donor</strong><br/>
           Area: ${escapeHtml(donor.area || "N/A")}<br/>
           Contact: <em>Protected (Hospital Access Only)</em>`;

      marker.bindPopup(`
        <div class="lifeline-popup">
          <span class="lifeline-popup-badge donor">DONOR · ${escapeHtml(donor.blood_group || "N/A")}</span><br/>
          ${popupDetails}
        </div>
      `);
      marker.addTo(donorLayer);
      bounds.push([lat, lng]);
      donorPinCount += 1;
    }
  });

  // 4. Add RED pulsing markers for open emergency requests (People who need blood)
  (requests || []).forEach((req) => {
    const status = String(req.status || "open").toLowerCase();
    if (status === "closed" || status === "fulfilled") return;

    let lat = parseFloat(req.latitude);
    let lng = parseFloat(req.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const inferred = inferCoordsFromText(req.area || req.hospital);
      lat = inferred[0];
      lng = inferred[1];
    }

    const icon = createBloodPinIcon("request", req.blood_group);
    const marker = L.marker([lat, lng], { icon, zIndexOffset: 1100 });
    marker.bindPopup(`
      <div class="lifeline-popup">
        <span class="lifeline-popup-badge request">🚨 EMERGENCY NEED · ${escapeHtml(req.blood_group || "N/A")}</span><br/>
        <strong>${escapeHtml(req.hospital || "Hospital / Patient")}</strong><br/>
        Area: ${escapeHtml(req.area || "Nearby Area")}<br/>
        Units Needed: <strong>${escapeHtml(String(req.units_needed || 1))} Unit(s)</strong><br/>
        Contact: ${escapeHtml(req.contact || "Emergency Desk")}
      </div>
    `);
    marker.addTo(requestLayer);
    bounds.push([lat, lng]);
    requestPinCount += 1;
  });

  // Update floating HUD counts
  const hudCounts = document.getElementById("hudCounts");
  if (hudCounts) {
    hudCounts.textContent = `${donorPinCount} Donors · ${requestPinCount} Active SOS ${matchedPinCount > 0 ? `· ${matchedPinCount} Matched` : ''}`;
  }

  lastBounds = bounds.length > 0 ? bounds : null;

  // Auto-zoom map to fit all visible markers
  if (lastBounds && mapInstance) {
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
