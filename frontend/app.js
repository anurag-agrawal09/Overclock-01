/* =====================================================
   Lifeline – app.js (Frontend logic & Backend API calls)
   Connects the 4 cards to the Flask backend at 127.0.0.1:5000
   ===================================================== */

const API_BASE = "http://127.0.0.1:5000";
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

// Keep latest fetched data in memory so the map can show both together
let currentDonors = [];
let currentRequests = [];

/* ---------- Helper: Show Toast Popup ---------- */
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hide"), 3200);
}

/* ---------- Helper: Safe HTML Escaping ---------- */
function safeText(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

/* ---------- Helper: Backend Connection Badge ---------- */
function setApiStatus(isOnline) {
  const pill = document.getElementById("apiStatus");
  const label = document.getElementById("apiStatusText");
  if (!pill || !label) return;

  pill.classList.remove("checking", "online", "offline");
  if (isOnline) {
    pill.classList.add("online");
    label.textContent = "Backend Connected";
  } else {
    pill.classList.add("offline");
    label.textContent = "Backend Offline";
  }
}

/* ---------- Helper: Theme Toggle (Light / Dark) ---------- */
function initTheme() {
  const saved = localStorage.getItem("lifeline-theme");
  if (saved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  const btn = document.getElementById("themeBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("lifeline-theme", next);
    });
  }
}

/* ---------- Helper: Fill GPS Coordinates ---------- */
function fillGps(latInputId, lngInputId) {
  if (!navigator.geolocation) {
    showToast("GPS is not supported by your browser.");
    return;
  }

  showToast("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById(latInputId).value = pos.coords.latitude.toFixed(5);
      document.getElementById(lngInputId).value = pos.coords.longitude.toFixed(5);
      showToast("Location coordinates filled!");
    },
    () => {
      showToast("Could not get GPS location. You can leave it blank.");
    }
  );
}

/* ---------- Hero Blood Group Quick Chips ---------- */
function renderBloodChips() {
  const container = document.getElementById("bloodChips");
  if (!container) return;

  container.innerHTML = BLOOD_GROUPS.map(
    (group) => `<button class="blood-chip" type="button" data-group="${group}">${group}</button>`
  ).join("");

  container.addEventListener("click", (event) => {
    const btn = event.target.closest(".blood-chip");
    if (!btn) return;

    const group = btn.dataset.group;
    document.querySelectorAll(".blood-chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");

    document.getElementById("searchBlood").value = group;
    fetchDonors();
    document.getElementById("card-find").scrollIntoView({ behavior: "smooth" });
  });
}

/* =====================================================
   1. CARD A: REGISTER AS DONOR (POST /api/donors)
   ===================================================== */
async function handleDonorSubmit(event) {
  event.preventDefault();

  const latVal = document.getElementById("donorLat").value.trim();
  const lngVal = document.getElementById("donorLng").value.trim();

  const payload = {
    name: document.getElementById("donorName").value.trim(),
    blood_group: document.getElementById("donorBlood").value,
    area: document.getElementById("donorArea").value.trim(),
    contact_preference: document.getElementById("donorContact").value.trim(),
    last_donation_date: document.getElementById("donorLastDate").value || null,
    is_visible: document.getElementById("donorVisible").checked,
    latitude: latVal ? parseFloat(latVal) : null,
    longitude: lngVal ? parseFloat(lngVal) : null
  };

  try {
    const res = await fetch(`${API_BASE}/api/donors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    showToast("Donor registered successfully!");
    event.target.reset();
    document.getElementById("donorVisible").checked = true;
    await fetchDonors();
  } catch (err) {
    console.error("Register donor error:", err);
    showToast("Could not register donor. Check Console (F12).");
  }
}

/* =====================================================
   2. CARD B: FIND DONORS (GET /api/donors?blood_group=...&area=...)
   ===================================================== */
async function fetchDonors() {
  const bloodGroup = document.getElementById("searchBlood").value;
  const area = document.getElementById("searchArea").value.trim();

  const params = new URLSearchParams();
  if (bloodGroup) params.append("blood_group", bloodGroup);
  if (area) params.append("area", area);

  const query = params.toString() ? `?${params.toString()}` : "";

  try {
    const res = await fetch(`${API_BASE}/api/donors${query}`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    currentDonors = Array.isArray(data) ? data : (data.donors || []);

    setApiStatus(true);
    renderDonors(currentDonors);
    document.getElementById("statDonors").textContent = currentDonors.length;
    updateMapMarkers(currentDonors, currentRequests);
  } catch (err) {
    console.error("Fetch donors error:", err);
    setApiStatus(false);
    document.getElementById("donorsList").innerHTML =
      `<p class="empty-state">Unable to load donors. Make sure the backend is running at ${API_BASE}.</p>`;
  }
}

function renderDonors(donors) {
  const list = document.getElementById("donorsList");
  if (!donors.length) {
    list.innerHTML = `<p class="empty-state">No matching visible donors found. Try clearing filters.</p>`;
    return;
  }

  list.innerHTML = donors
    .map(
      (d) => `
      <div class="item-card">
        <div class="item-top">
          <div class="item-title">
            <span class="blood-pill">${safeText(d.blood_group)}</span>
            <span>${safeText(d.name)}</span>
          </div>
          <span class="status-tag closed">Eligible</span>
        </div>
        <div class="item-meta">
          <span>📍 ${safeText(d.area)}</span>
          <span>📞 ${safeText(d.contact_preference)}</span>
          ${d.last_donation_date ? `<span>🗓️ Last donated: ${safeText(d.last_donation_date)}</span>` : ""}
        </div>
      </div>
    `
    )
    .join("");
}

/* =====================================================
   3. CARD C: EMERGENCY REQUEST BOARD (POST, GET, PATCH)
   ===================================================== */
async function handleRequestSubmit(event) {
  event.preventDefault();

  const latVal = document.getElementById("reqLat").value.trim();
  const lngVal = document.getElementById("reqLng").value.trim();

  const payload = {
    blood_group: document.getElementById("reqBlood").value,
    hospital: document.getElementById("reqHospital").value.trim(),
    area: document.getElementById("reqArea").value.trim(),
    units_needed: parseInt(document.getElementById("reqUnits").value, 10) || 1,
    contact: document.getElementById("reqContact").value.trim(),
    latitude: latVal ? parseFloat(latVal) : null,
    longitude: lngVal ? parseFloat(lngVal) : null
  };

  try {
    const res = await fetch(`${API_BASE}/api/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast("Emergency request posted!");
    event.target.reset();
    document.getElementById("reqUnits").value = "1";
    await Promise.all([fetchRequests(), fetchAlerts()]);
  } catch (err) {
    console.error("Post request error:", err);
    showToast("Could not post request. Check Console (F12).");
  }
}

async function fetchRequests() {
  try {
    const res = await fetch(`${API_BASE}/api/requests`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    currentRequests = Array.isArray(data) ? data : (data.requests || []);

    setApiStatus(true);
    renderRequests(currentRequests);

    const openCount = currentRequests.filter((r) => {
      const s = String(r.status || "open").toLowerCase();
      return s !== "closed" && s !== "fulfilled";
    }).length;
    document.getElementById("statOpenReqs").textContent = openCount;

    updateMapMarkers(currentDonors, currentRequests);
  } catch (err) {
    console.error("Fetch requests error:", err);
    setApiStatus(false);
    document.getElementById("requestsList").innerHTML =
      `<p class="empty-state">Unable to load emergency requests. Check backend at ${API_BASE}.</p>`;
  }
}

async function markRequestFulfilled(requestId) {
  try {
    const res = await fetch(`${API_BASE}/api/requests/${requestId}/close`, {
      method: "PATCH"
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast("Request marked as fulfilled!");
    await Promise.all([fetchRequests(), fetchAlerts()]);
  } catch (err) {
    console.error("Close request error:", err);
    showToast("Could not close request. Check Console (F12).");
  }
}

/**
 * UNIQUE STANDOUT FEATURE:
 * Copy a ready-to-share WhatsApp SOS message with one click.
 */
async function copyWhatsAppSOS(index) {
  const req = currentRequests[index];
  if (!req) return;

  const message =
    `🚨 *URGENT BLOOD NEEDED (${req.blood_group})* 🚨\n` +
    `🏥 Hospital: ${req.hospital}\n` +
    `📍 Area: ${req.area}\n` +
    `🩸 Units Needed: ${req.units_needed}\n` +
    `📞 Contact: ${req.contact}\n\n` +
    `Please share in your groups or reach out immediately if you can donate!`;

  try {
    await navigator.clipboard.writeText(message);
    showToast("WhatsApp SOS message copied! Paste it in any chat.");
  } catch (err) {
    console.error("Clipboard copy failed:", err);
    showToast("Copy failed. Please allow clipboard access.");
  }
}

function renderRequests(requests) {
  const list = document.getElementById("requestsList");
  if (!requests.length) {
    list.innerHTML = `<p class="empty-state">No emergency requests posted yet.</p>`;
    return;
  }

  list.innerHTML = requests
    .map((req, index) => {
      const status = String(req.status || "open").toLowerCase();
      const isClosed = status === "closed" || status === "fulfilled";
      const reqId = req.id ?? req.request_id;

      return `
        <div class="item-card">
          <div class="item-top">
            <div class="item-title">
              <span class="blood-pill">${safeText(req.blood_group)}</span>
              <span>${safeText(req.hospital)}</span>
            </div>
            <span class="status-tag ${isClosed ? "closed" : "open"}">
              ${isClosed ? "Fulfilled" : "Open SOS"}
            </span>
          </div>

          <div class="item-meta">
            <span>📍 ${safeText(req.area)}</span>
            <span>🩸 ${safeText(req.units_needed)} unit(s)</span>
            <span>📞 ${safeText(req.contact)}</span>
          </div>

          <div class="item-actions">
            <button class="btn sm whatsapp" type="button" onclick="copyWhatsAppSOS(${index})">
              📋 Copy WhatsApp SOS Message
            </button>
            ${
              !isClosed && reqId != null
                ? `<button class="btn sm ok-btn" type="button" onclick="markRequestFulfilled(${reqId})">
                     ✓ Mark Fulfilled
                   </button>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
}

/* =====================================================
   4. CARD D: LIVE ALERTS (GET /api/alerts)
   ===================================================== */
async function fetchAlerts() {
  try {
    const res = await fetch(`${API_BASE}/api/alerts`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    const alerts = Array.isArray(data) ? data : (data.alerts || []);

    document.getElementById("statAlerts").textContent = alerts.length;
    renderAlerts(alerts);
  } catch (err) {
    console.error("Fetch alerts error:", err);
    document.getElementById("alertsList").innerHTML =
      `<p class="empty-state">Unable to load alerts. Check backend at ${API_BASE}.</p>`;
  }
}

function renderAlerts(alerts) {
  const list = document.getElementById("alertsList");
  if (!alerts.length) {
    list.innerHTML = `<p class="empty-state">No live alerts right now.</p>`;
    return;
  }

  list.innerHTML = alerts
    .map((alert) => {
      const msg = alert.message || alert.text || alert.title || JSON.stringify(alert);
      const time = alert.created_at || alert.timestamp || "";
      return `
        <div class="item-card alert-item">
          <div class="item-title">🔔 ${safeText(msg)}</div>
          ${time ? `<div class="item-meta"><span>🕒 ${safeText(time)}</span></div>` : ""}
        </div>
      `;
    })
    .join("");
}

/* =====================================================
   INITIALIZE APP ON PAGE LOAD
   ===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  renderBloodChips();
  initMap();

  // Wire up forms and buttons
  document.getElementById("donorForm").addEventListener("submit", handleDonorSubmit);
  document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    fetchDonors();
  });
  document.getElementById("resetSearchBtn").addEventListener("click", () => {
    document.getElementById("searchBlood").value = "";
    document.getElementById("searchArea").value = "";
    document.querySelectorAll(".blood-chip").forEach((c) => c.classList.remove("active"));
    fetchDonors();
  });

  document.getElementById("requestForm").addEventListener("submit", handleRequestSubmit);
  document.getElementById("refreshRequestsBtn").addEventListener("click", fetchRequests);
  document.getElementById("refreshAlertsBtn").addEventListener("click", fetchAlerts);
  document.getElementById("recenterMapBtn").addEventListener("click", recenterMap);

  document.getElementById("donorGpsBtn").addEventListener("click", () => fillGps("donorLat", "donorLng"));
  document.getElementById("reqGpsBtn").addEventListener("click", () => fillGps("reqLat", "reqLng"));

  // Load initial data from backend
  fetchDonors();
  fetchRequests();
  fetchAlerts();
});
