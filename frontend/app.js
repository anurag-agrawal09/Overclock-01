/* =====================================================
   LifeLink – app.js
   Multi-View Auth + Donor & Hospital Dashboards
   Connected 100% to Flask Backend (http://127.0.0.1:5000)
   ===================================================== */

const API_BASE = "http://127.0.0.1:5000";
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

let currentDonors = [];
let currentRequests = [];
let currentAlerts = [];
let currentRole = "donor"; // "donor" | "hospital"
let currentUser = { name: "Guest Donor", info: "Volunteer Donor Network" };
let loginRoleSelected = "donor";

/* ---------- Helper: Toast Notification ---------- */
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

/* ---------- Helper: Backend Connection Status ---------- */
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

/* ---------- Helper: GPS Auto-Fill ---------- */
function fillGps(latId, lngId) {
  if (!navigator.geolocation) {
    showToast("GPS is not supported in this browser.");
    return;
  }
  showToast("Getting your GPS location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById(latId).value = pos.coords.latitude.toFixed(5);
      document.getElementById(lngId).value = pos.coords.longitude.toFixed(5);
      showToast("Coordinates filled!");
    },
    () => showToast("GPS blocked or unavailable. You can leave coordinates blank.")
  );
}

/* =====================================================
   SCREEN & NAVIGATION CONTROLLER
   ===================================================== */
function showScreen(screenName) {
  const screens = ["view-login", "view-donor-register", "view-hospital-register", "app-shell"];
  screens.forEach((id) => document.getElementById(id).classList.add("hidden"));

  if (screenName === "app") {
    document.getElementById("app-shell").classList.remove("hidden");
    renderSidebarForRole();
    applyRoleCopy();
    navigateTab("dashboard");
    refreshAllData();
  } else {
    document.getElementById(`view-${screenName}`).classList.remove("hidden");
  }
}

function renderSidebarForRole() {
  const nav = document.getElementById("sidebarNav");
  const alertBadge = currentAlerts.length > 0 ? `<span class="nav-badge">${currentAlerts.length}</span>` : "";

  const donorLinks = [
    { id: "dashboard", icon: "🏠", label: "Dashboard" },
    { id: "find-donors", icon: "🔍", label: "Find Donors" },
    { id: "requests", icon: "💓", label: "Nearby Requests" },
    { id: "map", icon: "📍", label: "Donors Map" },
    { id: "create-request", icon: "🚨", label: "Post SOS Request" },
    { id: "notifications", icon: "🔔", label: "Notifications", badge: alertBadge },
    { id: "profile", icon: "👤", label: "My Profile" }
  ];

  const hospitalLinks = [
    { id: "dashboard", icon: "🏠", label: "Dashboard" },
    { id: "create-request", icon: "➕", label: "Create Blood Request" },
    { id: "requests", icon: "📋", label: "My Blood Requests" },
    { id: "find-donors", icon: "👥", label: "Find Donors" },
    { id: "map", icon: "📍", label: "Live Map" },
    { id: "notifications", icon: "🔔", label: "Notifications", badge: alertBadge },
    { id: "profile", icon: "🏥", label: "Hospital Profile" }
  ];

  const links = currentRole === "hospital" ? hospitalLinks : donorLinks;
  nav.innerHTML = links
    .map(
      (item) => `
      <button class="sidebar-link" type="button" data-tab="${item.id}" onclick="navigateTab('${item.id}')">
        <span>${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge || ""}
      </button>
    `
    )
    .join("");

  document.getElementById("switchRoleLabel").textContent =
    currentRole === "hospital" ? "Switch to Donor View" : "Switch to Hospital View";
  document.getElementById("sidebarMottoText").innerHTML =
    currentRole === "hospital" ? "Together we can<br/>save lives" : "Be a Hero,<br/>Donate Blood";
}

function applyRoleCopy() {
  const isHosp = currentRole === "hospital";
  document.getElementById("userChipIcon").textContent = isHosp ? "🏥" : "👤";
  document.getElementById("userChipName").textContent = currentUser.name;

  document.getElementById("welcomeBannerIcon").textContent = isHosp ? "🏥" : "🩸";
  document.getElementById("welcomeTitle").textContent = isHosp
    ? `Welcome Back, ${currentUser.name}!`
    : `Welcome Back, ${currentUser.name}!`;
  document.getElementById("welcomeSubtitle").textContent = isHosp
    ? "Manage your emergency blood requests and alert compatible donors nearby in seconds."
    : "Every drop counts. Respond to nearby emergencies or find eligible donors fast.";

  const quotePill = document.getElementById("welcomeQuotePill");
  const ctaBtn = document.getElementById("bannerCtaBtn");
  if (isHosp) {
    quotePill.classList.add("hidden");
    ctaBtn.classList.remove("hidden");
  } else {
    quotePill.classList.remove("hidden");
    ctaBtn.classList.add("hidden");
  }

  document.getElementById("profileDetails").innerHTML = `
    <p><strong>Role:</strong> ${isHosp ? "Hospital / Blood Bank" : "Volunteer Blood Donor"}</p>
    <p><strong>Name:</strong> ${safeText(currentUser.name)}</p>
    <p><strong>Details:</strong> ${safeText(currentUser.info || "Active LifeLink Member")}</p>
    <p><strong>Backend API:</strong> ${API_BASE}</p>
  `;
}

function navigateTab(tabId) {
  // Highlight active sidebar button
  document.querySelectorAll(".sidebar-link[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  // Show selected tab panel
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.remove("hidden");

  // Update top header title
  const titles = {
    dashboard: currentRole === "hospital" ? "Hospital Command Center" : "Donor Dashboard",
    "find-donors": "Find Eligible Donors",
    "create-request": "Create Emergency Blood Request",
    requests: "Emergency Request Board",
    map: "Live Donors & Requests Map",
    notifications: "Smart Compatibility Alerts",
    profile: "Account & Network Info"
  };
  document.getElementById("topPageTitle").textContent = titles[tabId] || "Dashboard";

  // Move shared #map element cleanly between Dashboard preview and Full Map tab
  const mapEl = document.getElementById("map");
  if (tabId === "map" && mapEl) {
    document.getElementById("mapSlotFull").appendChild(mapEl);
    refreshMapSize();
  } else if (tabId === "dashboard" && mapEl) {
    document.getElementById("mapSlotDashboard").appendChild(mapEl);
    refreshMapSize();
  }

  // Close mobile drawer if open
  document.querySelector(".sidebar").classList.remove("open");
}

/* =====================================================
   BACKEND API CALLS
   ===================================================== */
async function refreshAllData() {
  await Promise.all([fetchDonors(), fetchRequests(), fetchAlerts()]);
}

async function fetchDonors() {
  const bloodGroup = (document.getElementById("searchBlood")?.value || "").trim();
  const area = (document.getElementById("searchArea")?.value || "").trim();

  const params = new URLSearchParams();
  if (bloodGroup) params.append("blood_group", bloodGroup);
  if (area) params.append("area", area);
  const query = params.toString() ? `?${params.toString()}` : "";

  try {
    const res = await fetch(`${API_BASE}/api/donors${query}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentDonors = Array.isArray(data) ? data : (data.donors || []);

    setApiStatus(true);
    document.getElementById("kpiVal1").textContent = currentDonors.length;
    renderDonors(currentDonors);
    updateMapMarkers(currentDonors, currentRequests);
  } catch (err) {
    console.error("Fetch donors error:", err);
    setApiStatus(false);
    document.getElementById("donorsList").innerHTML =
      `<p class="empty-state">Unable to load donors. Make sure backend is running at ${API_BASE}.</p>`;
  }
}

async function fetchRequests() {
  try {
    const res = await fetch(`${API_BASE}/api/requests`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentRequests = Array.isArray(data) ? data : (data.requests || []);

    setApiStatus(true);
    const openCount = currentRequests.filter((r) => String(r.status || "open").toLowerCase() === "open").length;
    document.getElementById("kpiVal2").textContent = openCount;

    renderRequests(currentRequests);
    renderDashboardRequests(currentRequests);
    updateMapMarkers(currentDonors, currentRequests);
  } catch (err) {
    console.error("Fetch requests error:", err);
    setApiStatus(false);
  }
}

async function fetchAlerts() {
  try {
    const res = await fetch(`${API_BASE}/api/alerts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentAlerts = Array.isArray(data) ? data : (data.alerts || []);

    document.getElementById("kpiVal3").textContent = currentAlerts.length;
    document.getElementById("bellCount").textContent = currentAlerts.length;
    renderAlerts(currentAlerts);
    renderSidebarForRole();
  } catch (err) {
    console.error("Fetch alerts error:", err);
  }
}

/* =====================================================
   RENDERERS
   ===================================================== */
function renderDonors(donors) {
  const list = document.getElementById("donorsList");
  if (!donors.length) {
    list.innerHTML = `<p class="empty-state">No matching eligible donors found. Try clearing filters.</p>`;
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
          ${d.last_donation_date ? `<span>🗓️ Last: ${safeText(d.last_donation_date)}</span>` : ""}
        </div>
      </div>
    `
    )
    .join("");
}

function renderDashboardRequests(requests) {
  const list = document.getElementById("dashRequestsList");
  const openReqs = requests.filter((r) => String(r.status || "open").toLowerCase() === "open").slice(0, 3);

  if (!openReqs.length) {
    list.innerHTML = `<p class="empty-state">No active emergency requests right now.</p>`;
  } else {
    list.innerHTML = openReqs
      .map((req) => {
        const idx = currentRequests.indexOf(req);
        return `
        <div class="item-card">
          <div class="item-top">
            <div class="item-title">
              <span class="blood-pill">${safeText(req.blood_group)}</span>
              <span>${safeText(req.hospital)}</span>
            </div>
            <button class="btn-pill-sm" type="button" onclick="copyWhatsAppSOS(${idx})">Share SOS</button>
          </div>
          <div class="item-meta">
            <span>📍 ${safeText(req.area)}</span>
            <span>🩸 ${safeText(req.units_needed)} unit(s)</span>
            <span>📞 ${safeText(req.contact)}</span>
          </div>
        </div>
      `;
      })
      .join("");
  }

  // Table rows
  const tbody = document.getElementById("dashTableBody");
  const topRows = requests.slice(0, 5);
  if (!topRows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No requests yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = topRows
    .map((req) => {
      const isClosed = String(req.status || "open").toLowerCase() === "closed";
      return `
      <tr>
        <td><span class="blood-pill">${safeText(req.blood_group)}</span></td>
        <td>${safeText(req.hospital)} · ${safeText(req.area)}</td>
        <td>${safeText(req.units_needed)}</td>
        <td><span class="status-tag ${isClosed ? "closed" : "open"}">${isClosed ? "Fulfilled" : "Open SOS"}</span></td>
      </tr>
    `;
    })
    .join("");
}

function renderRequests(requests) {
  const list = document.getElementById("requestsList");
  if (!requests.length) {
    list.innerHTML = `<p class="empty-state">No emergency requests posted yet.</p>`;
    return;
  }

  list.innerHTML = requests
    .map((req, index) => {
      const isClosed = String(req.status || "open").toLowerCase() === "closed";
      const reqId = req.id ?? req.request_id;
      return `
      <div class="item-card">
        <div class="item-top">
          <div class="item-title">
            <span class="blood-pill">${safeText(req.blood_group)}</span>
            <span>${safeText(req.hospital)}</span>
          </div>
          <span class="status-tag ${isClosed ? "closed" : "open"}">${isClosed ? "Fulfilled" : "Open SOS"}</span>
        </div>
        <div class="item-meta">
          <span>📍 ${safeText(req.area)}</span>
          <span>🩸 ${safeText(req.units_needed)} unit(s)</span>
          <span>📞 ${safeText(req.contact)}</span>
        </div>
        <div class="item-actions">
          <button class="btn-wa" type="button" onclick="copyWhatsAppSOS(${index})">📋 Copy WhatsApp SOS</button>
          ${
            !isClosed && reqId != null
              ? `<button class="btn-close-req" type="button" onclick="markRequestFulfilled(${reqId})">✓ Mark Fulfilled</button>`
              : ""
          }
        </div>
      </div>
    `;
    })
    .join("");
}

function renderAlerts(alerts) {
  const list = document.getElementById("alertsList");
  if (!alerts.length) {
    list.innerHTML = `<p class="empty-state">No live alerts right now.</p>`;
    return;
  }
  list.innerHTML = alerts
    .map(
      (a) => `
      <div class="item-card">
        <div class="item-title">🔔 ${safeText(a.message || JSON.stringify(a))}</div>
        <div class="item-meta">
          ${a.donor_name ? `<span>👤 To: ${safeText(a.donor_name)} (${safeText(a.blood_group)})</span>` : ""}
          ${a.created_at ? `<span>🕒 ${safeText(a.created_at)}</span>` : ""}
        </div>
      </div>
    `
    )
    .join("");
}

function renderBloodChips() {
  const box = document.getElementById("bloodChips");
  if (!box) return;
  box.innerHTML = BLOOD_GROUPS.map(
    (g) => `<button class="blood-chip" type="button" data-group="${g}">${g}</button>`
  ).join("");

  box.addEventListener("click", (e) => {
    const btn = e.target.closest(".blood-chip");
    if (!btn) return;
    document.querySelectorAll(".blood-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("searchBlood").value = btn.dataset.group;
    fetchDonors();
  });
}

/* =====================================================
   ACTIONS & FORM SUBMISSIONS
   ===================================================== */
async function copyWhatsAppSOS(index) {
  const req = currentRequests[index];
  if (!req) return;
  const message =
    `🚨 *URGENT BLOOD NEEDED (${req.blood_group})* 🚨\n` +
    `🏥 Hospital: ${req.hospital}\n` +
    `📍 Area: ${req.area}\n` +
    `🩸 Units Needed: ${req.units_needed}\n` +
    `📞 Contact: ${req.contact}\n\n` +
    `Please share or contact immediately if you can donate!`;
  try {
    await navigator.clipboard.writeText(message);
    showToast("WhatsApp SOS message copied!");
  } catch {
    showToast("Could not copy message. Please allow clipboard access.");
  }
}

async function markRequestFulfilled(requestId) {
  try {
    const res = await fetch(`${API_BASE}/api/requests/${requestId}/close`, { method: "PATCH" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("Request marked as fulfilled!");
    await Promise.all([fetchRequests(), fetchAlerts()]);
  } catch (err) {
    console.error(err);
    showToast("Could not close request.");
  }
}

/* =====================================================
   INITIALIZE EVERYTHING
   ===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  renderBloodChips();

  // Login Role Toggle
  document.querySelectorAll(".role-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".role-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      loginRoleSelected = tab.dataset.role;
      document.getElementById("loginSubtitle").textContent =
        loginRoleSelected === "hospital"
          ? "Hospital Portal: Post urgent blood requests & find matching donors"
          : "Donor Portal: Find eligible donors or respond to nearby emergencies";
    });
  });

  // Password eye toggle
  document.getElementById("togglePassBtn").addEventListener("click", () => {
    const pass = document.getElementById("loginPassword");
    pass.type = pass.type === "password" ? "text" : "password";
  });

  // Login Submit
  document.getElementById("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const mobile = document.getElementById("loginMobile").value.trim();
    currentRole = loginRoleSelected;
    currentUser = {
      name: currentRole === "hospital" ? "City Hospital" : mobile || "Lifesaver Donor",
      info: `Signed in via ${mobile}`
    };
    showToast(`Welcome to LifeLink (${currentRole === "hospital" ? "Hospital" : "Donor"} Portal)!`);
    showScreen("app");
  });

  // Quick Demo Buttons
  document.getElementById("demoDonorBtn").addEventListener("click", () => {
    currentRole = "donor";
    currentUser = { name: "Aarav (Donor)", info: "Demo Volunteer Donor" };
    showScreen("app");
  });

  document.getElementById("demoHospitalBtn").addEventListener("click", () => {
    currentRole = "hospital";
    currentUser = { name: "City Memorial Hospital", info: "Demo Emergency Desk" };
    showScreen("app");
  });

  // Donor Registration -> POST /api/donors
  document.getElementById("donorRegForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const city = document.getElementById("regDonorCity").value.trim();
    const area = document.getElementById("regDonorArea").value.trim();
    const lat = document.getElementById("regDonorLat").value.trim();
    const lng = document.getElementById("regDonorLng").value.trim();

    const payload = {
      name: document.getElementById("regDonorName").value.trim(),
      blood_group: document.getElementById("regDonorBlood").value,
      area: city ? `${area}, ${city}` : area,
      contact_preference: document.getElementById("regDonorContact").value.trim(),
      last_donation_date: document.getElementById("regDonorLastDate").value || "",
      is_visible: document.getElementById("regDonorVisible").checked,
      latitude: lat ? parseFloat(lat) : null,
      longitude: lng ? parseFloat(lng) : null
    };

    try {
      const res = await fetch(`${API_BASE}/api/donors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      currentRole = "donor";
      currentUser = { name: payload.name, info: `${payload.blood_group} · ${payload.area}` };
      showToast("Donor registered & saved to database!");
      e.target.reset();
      showScreen("app");
    } catch (err) {
      console.error(err);
      showToast("Could not register donor. Make sure backend is running.");
    }
  });

  // Hospital Registration -> Enter Hospital Portal
  document.getElementById("hospitalRegForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const hospName = document.getElementById("regHospName").value.trim();
    const area = document.getElementById("regHospArea").value.trim();
    currentRole = "hospital";
    currentUser = { name: hospName, info: `Reg ID: ${document.getElementById("regHospRegNo").value.trim()} · ${area}` };
    showToast("Hospital registered! Welcome to your Command Center.");
    e.target.reset();
    showScreen("app");
  });

  // Search Donors
  document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    fetchDonors();
  });

  document.getElementById("resetSearchBtn").addEventListener("click", () => {
    document.getElementById("searchBlood").value = "";
    document.getElementById("searchArea").value = "";
    document.querySelectorAll(".blood-chip").forEach((b) => b.classList.remove("active"));
    fetchDonors();
  });

  // Create Emergency Request -> POST /api/requests
  document.getElementById("requestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lat = document.getElementById("reqLat").value.trim();
    const lng = document.getElementById("reqLng").value.trim();

    const payload = {
      blood_group: document.getElementById("reqBlood").value,
      hospital: document.getElementById("reqHospital").value.trim(),
      area: document.getElementById("reqArea").value.trim(),
      units_needed: parseInt(document.getElementById("reqUnits").value, 10) || 1,
      contact: document.getElementById("reqContact").value.trim(),
      latitude: lat ? parseFloat(lat) : null,
      longitude: lng ? parseFloat(lng) : null
    };

    try {
      const res = await fetch(`${API_BASE}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      showToast("Emergency request broadcasted & alerts sent!");
      e.target.reset();
      document.getElementById("reqUnits").value = "1";
      await Promise.all([fetchRequests(), fetchAlerts()]);
      navigateTab("requests");
    } catch (err) {
      console.error(err);
      showToast("Could not post request. Check backend connection.");
    }
  });

  // GPS & Refresh Buttons
  document.getElementById("regDonorGpsBtn").addEventListener("click", () => fillGps("regDonorLat", "regDonorLng"));
  document.getElementById("reqGpsBtn").addEventListener("click", () => fillGps("reqLat", "reqLng"));
  document.getElementById("recenterMapBtn").addEventListener("click", recenterMap);
  document.getElementById("refreshRequestsBtn").addEventListener("click", fetchRequests);
  document.getElementById("refreshAlertsBtn").addEventListener("click", fetchAlerts);

  // Switch Role & Logout
  document.getElementById("switchRoleBtn").addEventListener("click", () => {
    currentRole = currentRole === "hospital" ? "donor" : "hospital";
    currentUser.name = currentRole === "hospital" ? "City Memorial Hospital" : "Aarav (Donor)";
    renderSidebarForRole();
    applyRoleCopy();
    navigateTab("dashboard");
    showToast(`Switched to ${currentRole === "hospital" ? "Hospital" : "Donor"} View`);
  });

  document.getElementById("logoutBtn").addEventListener("click", () => showScreen("login"));

  // Mobile Menu Drawer
  document.getElementById("mobileMenuBtn").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });

  // Check backend health immediately
  fetch(`${API_BASE}/api/health`)
    .then((r) => setApiStatus(r.ok))
    .catch(() => setApiStatus(false));
});
