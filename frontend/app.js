/* =====================================================
   LifeLink – app.js
   - Session persistence (never throws user back to login on submit/refresh)
   - Role-based security (personal donor info & Find Donors protected for Hospital only)
   - Smart area-to-coordinate mapping (no manual GPS input needed)
   - Clean text without leading symbols/emojis
   ===================================================== */

const API_BASE = "http://127.0.0.1:5000";
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const SESSION_KEY = "lifeline_session_v1";

let currentDonors = [];
let currentRequests = [];
let currentAlerts = [];
let currentRole = "donor"; // "donor" | "hospital"
let currentScreen = "login";
let currentTab = "dashboard";
let currentUser = { name: "Guest Donor", info: "Volunteer Donor Network" };
let loginRoleSelected = "donor";

/* ---------- Area Coordinate Lookup (Auto-places pins near patient area) ---------- */
const AREA_COORDS = {
  lucknow: [26.8467, 80.9462],
  hazratganj: [26.8501, 80.9499],
  gomti: [26.8565, 81.0012],
  kanpur: [26.4499, 80.3319],
  indiranagar: [12.9784, 77.6408],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  delhi: [28.6139, 77.209],
  mumbai: [19.076, 72.8777],
  downtown: [26.8467, 80.9462],
  northside: [26.87, 80.94]
};

function inferCoordsFromArea(areaText) {
  const lower = (areaText || "").toLowerCase();
  let base = [26.8467, 80.9462]; // Default city center
  for (const [key, coords] of Object.entries(AREA_COORDS)) {
    if (lower.includes(key)) {
      base = coords;
      break;
    }
  }
  // Small deterministic-style offset so pins in the same area don't overlap
  const jitterLat = (Math.random() - 0.5) * 0.018;
  const jitterLng = (Math.random() - 0.5) * 0.018;
  return {
    latitude: parseFloat((base[0] + jitterLat).toFixed(5)),
    longitude: parseFloat((base[1] + jitterLng).toFixed(5))
  };
}

/* ---------- Session Persistence (Prevents throwing back to Login) ---------- */
function saveSession() {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        currentScreen,
        currentTab,
        currentRole,
        currentUser
      })
    );
  } catch {
    // Ignore storage errors
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore
  }
}

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

/* =====================================================
   SCREEN & NAVIGATION CONTROLLER
   ===================================================== */
function showScreen(screenName, targetTab = "dashboard") {
  currentScreen = screenName;
  const screens = ["view-login", "view-donor-register", "view-hospital-register", "app-shell"];
  screens.forEach((id) => document.getElementById(id).classList.add("hidden"));

  if (screenName === "app") {
    document.getElementById("app-shell").classList.remove("hidden");
    renderSidebarForRole();
    renderQuickActionsForRole();
    applyRoleCopy();
    navigateTab(targetTab);
    refreshAllData();
  } else {
    document.getElementById(`view-${screenName}`).classList.remove("hidden");
  }
  saveSession();
}

function renderSidebarForRole() {
  const nav = document.getElementById("sidebarNav");
  const alertBadge = currentAlerts.length > 0 ? `<span class="nav-badge">${currentAlerts.length}</span>` : "";

  // Donor screen: NO "Switch to Hospital", NO "Find Donors" (personal donor info protected!)
  const donorLinks = [
    { id: "dashboard", label: "Dashboard" },
    { id: "requests", label: "Nearby Requests" },
    { id: "map", label: "Donors & Requests Map" },
    { id: "create-request", label: "Post SOS Request" },
    { id: "notifications", label: "Notifications", badge: alertBadge },
    { id: "profile", label: "My Profile" }
  ];

  // Hospital screen: Full access to Find Donors & patient matching
  const hospitalLinks = [
    { id: "dashboard", label: "Dashboard" },
    { id: "create-request", label: "Create Blood Request" },
    { id: "requests", label: "My Blood Requests" },
    { id: "find-donors", label: "Find Donors (Protected)" },
    { id: "map", label: "Live Map" },
    { id: "notifications", label: "Notifications", badge: alertBadge },
    { id: "profile", label: "Hospital Profile" }
  ];

  const links = currentRole === "hospital" ? hospitalLinks : donorLinks;
  nav.innerHTML = links
    .map(
      (item) => `
      <button class="sidebar-link ${currentTab === item.id ? "active" : ""}" type="button" data-tab="${item.id}" onclick="navigateTab('${item.id}')">
        <span>${item.label}</span>
        ${item.badge || ""}
      </button>
    `
    )
    .join("");

  document.getElementById("sidebarMottoText").innerHTML =
    currentRole === "hospital" ? "Together we can<br/>save lives" : "Be a Hero,<br/>Donate Blood";
}

function renderQuickActionsForRole() {
  const grid = document.getElementById("quickActionsGrid");
  if (!grid) return;

  if (currentRole === "hospital") {
    grid.innerHTML = `
      <button class="qa-tile" type="button" onclick="navigateTab('find-donors')">
        <b>Find Nearby Donors</b>
      </button>
      <button class="qa-tile" type="button" onclick="navigateTab('create-request')">
        <b>Post Emergency SOS</b>
      </button>
      <button class="qa-tile" type="button" onclick="navigateTab('notifications')">
        <b>Check Live Alerts</b>
      </button>
      <button class="qa-tile" type="button" onclick="navigateTab('map')">
        <b>Open Live Map</b>
      </button>
    `;
  } else {
    grid.innerHTML = `
      <button class="qa-tile" type="button" onclick="navigateTab('requests')">
        <b>View Emergencies</b>
      </button>
      <button class="qa-tile" type="button" onclick="navigateTab('create-request')">
        <b>Post SOS Request</b>
      </button>
      <button class="qa-tile" type="button" onclick="navigateTab('notifications')">
        <b>Check Notifications</b>
      </button>
      <button class="qa-tile" type="button" onclick="navigateTab('map')">
        <b>Open Live Map</b>
      </button>
    `;
  }
}

function applyRoleCopy() {
  const isHosp = currentRole === "hospital";
  const displayName = currentUser.name || (isHosp ? "Hospital" : "Donor");

  document.getElementById("userChipName").textContent = displayName;
  document.getElementById("welcomeTitle").textContent = `Welcome Back, ${displayName}!`;
  document.getElementById("welcomeSubtitle").textContent = isHosp
    ? "Manage your emergency blood requests and locate matching eligible donors nearby."
    : "Every drop counts. Respond to nearby emergencies and help save lives.";

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
    <p><strong>Role:</strong> ${isHosp ? "Verified Hospital / Blood Bank" : "Volunteer Blood Donor"}</p>
    <p><strong>Name:</strong> ${safeText(displayName)}</p>
    <p><strong>Details:</strong> ${safeText(currentUser.info || "Active LifeLink Member")}</p>
    <p><strong>Privacy Status:</strong> ${isHosp ? "Authorized to view eligible donor contacts" : "Personal contact details are protected (Hospital Access Only)"}</p>
    <p><strong>Backend API:</strong> ${API_BASE}</p>
  `;
}

function navigateTab(tabId) {
  // Security guard: Donors cannot open Find Donors personal directory
  if (tabId === "find-donors" && currentRole !== "hospital") {
    showToast("Access protected: Only verified hospitals can view donor personal details.");
    tabId = "dashboard";
  }

  currentTab = tabId;
  saveSession();

  document.querySelectorAll(".sidebar-link[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.remove("hidden");

  const titles = {
    dashboard: currentRole === "hospital" ? "Hospital Command Center" : "Donor Dashboard",
    "find-donors": "Find Eligible Donors Near Patient",
    "create-request": "Create Emergency Blood Request",
    requests: "Emergency Request Board",
    map: "Live Donors & Requests Map",
    notifications: "Smart Compatibility Alerts",
    profile: "Account & Network Info"
  };
  document.getElementById("topPageTitle").textContent = titles[tabId] || "Dashboard";

  const mapEl = document.getElementById("map");
  if (tabId === "map" && mapEl) {
    document.getElementById("mapSlotFull").appendChild(mapEl);
    refreshMapSize();
  } else if (tabId === "dashboard" && mapEl) {
    document.getElementById("mapSlotDashboard").appendChild(mapEl);
    refreshMapSize();
  }

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
    updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital");
  } catch (err) {
    console.error("Fetch donors error:", err);
    setApiStatus(false);
    const list = document.getElementById("donorsList");
    if (list) {
      list.innerHTML = `<p class="empty-state">Unable to load donors. Make sure backend is running at ${API_BASE}.</p>`;
    }
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
    updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital");
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
   FIND DONORS NEAR PATIENT REQUIREMENT (HOSPITAL)
   ===================================================== */
async function findDonorsNearRequest(bloodGroup, area) {
  if (currentRole !== "hospital") {
    showToast("Only verified hospitals can access donor contact details.");
    return;
  }
  document.getElementById("searchBlood").value = bloodGroup || "";
  document.getElementById("searchArea").value = area || "";
  navigateTab("find-donors");
  await fetchDonors();
  showToast(`Showing eligible ${bloodGroup || "all"} donors near ${area || "patient"}`);
}

/* =====================================================
   RENDERERS (CLEAN TEXT - NO LEADING SYMBOLS)
   ===================================================== */
function renderDonors(donors) {
  const list = document.getElementById("donorsList");
  if (!list) return;

  if (currentRole !== "hospital") {
    list.innerHTML = `<p class="empty-state">Personal donor information is protected and accessible only by verified hospitals.</p>`;
    return;
  }

  if (!donors.length) {
    list.innerHTML = `<p class="empty-state">No matching eligible donors found near this area. Try clearing filters.</p>`;
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
          <span>Area: ${safeText(d.area)}</span>
          <span>Contact: ${safeText(d.contact_preference)}</span>
          ${d.last_donation_date ? `<span>Last Donated: ${safeText(d.last_donation_date)}</span>` : ""}
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
        const bgEsc = safeText(req.blood_group).replace(/'/g, "");
        const areaEsc = safeText(req.area).replace(/'/g, "");
        return `
        <div class="item-card">
          <div class="item-top">
            <div class="item-title">
              <span class="blood-pill">${safeText(req.blood_group)}</span>
              <span>${safeText(req.hospital)}</span>
            </div>
            <div class="head-actions">
              ${
                currentRole === "hospital"
                  ? `<button class="btn-pill-ghost" type="button" onclick="findDonorsNearRequest('${bgEsc}', '${areaEsc}')">Match Donors</button>`
                  : ""
              }
              <button class="btn-pill-sm" type="button" onclick="copyWhatsAppSOS(${idx})">Share SOS</button>
            </div>
          </div>
          <div class="item-meta">
            <span>Area: ${safeText(req.area)}</span>
            <span>Units: ${safeText(req.units_needed)}</span>
            <span>Contact: ${safeText(req.contact)}</span>
          </div>
        </div>
      `;
      })
      .join("");
  }

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
      const bgEsc = safeText(req.blood_group).replace(/'/g, "");
      const areaEsc = safeText(req.area).replace(/'/g, "");
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
          <span>Area: ${safeText(req.area)}</span>
          <span>Units: ${safeText(req.units_needed)}</span>
          <span>Contact: ${safeText(req.contact)}</span>
        </div>
        <div class="item-actions">
          <button class="btn-wa" type="button" onclick="copyWhatsAppSOS(${index})">Copy WhatsApp SOS</button>
          ${
            currentRole === "hospital" && !isClosed
              ? `<button class="btn-pill-ghost" type="button" onclick="findDonorsNearRequest('${bgEsc}', '${areaEsc}')">Find Nearby Donors</button>`
              : ""
          }
          ${
            !isClosed && reqId != null
              ? `<button class="btn-close-req" type="button" onclick="markRequestFulfilled(${reqId})">Mark Fulfilled</button>`
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
        <div class="item-title">${safeText(a.message || JSON.stringify(a))}</div>
        <div class="item-meta">
          ${currentRole === "hospital" && a.donor_name ? `<span>To: ${safeText(a.donor_name)} (${safeText(a.blood_group)})</span>` : ""}
          ${a.created_at ? `<span>Time: ${safeText(a.created_at)}</span>` : ""}
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
    `URGENT BLOOD NEEDED (${req.blood_group})\n` +
    `Hospital: ${req.hospital}\n` +
    `Area: ${req.area}\n` +
    `Units Needed: ${req.units_needed}\n` +
    `Contact: ${req.contact}\n\n` +
    `Please share or contact immediately if you can donate.`;
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

  // Restore session if user refreshed or Live Server reloaded after DB update
  const saved = loadSession();
  if (saved && saved.currentScreen && saved.currentScreen !== "login") {
    currentRole = saved.currentRole || "donor";
    currentUser = saved.currentUser || { name: "Donor", info: "LifeLink Member" };
    currentTab = saved.currentTab || "dashboard";
    showScreen(saved.currentScreen, currentTab);
  }

  // Login Role Toggle
  document.querySelectorAll(".role-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".role-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      loginRoleSelected = tab.dataset.role;
      document.getElementById("loginSubtitle").textContent =
        loginRoleSelected === "hospital"
          ? "Hospital Portal: Post urgent blood requests & find matching donors"
          : "Donor Portal: View nearby emergencies and respond to save lives";
    });
  });

  // Password show/hide toggle
  document.getElementById("togglePassBtn").addEventListener("click", () => {
    const pass = document.getElementById("loginPassword");
    const btn = document.getElementById("togglePassBtn");
    const showing = pass.type === "text";
    pass.type = showing ? "password" : "text";
    btn.textContent = showing ? "Show" : "Hide";
  });

  // Login Submit: Strict verification - rejects fake/unregistered credentials!
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const entered = document.getElementById("loginMobile").value.trim();
    const password = document.getElementById("loginPassword").value.trim();
    currentRole = loginRoleSelected;

    showToast("Verifying credentials with database...");

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: currentRole,
          identifier: entered,
          password: password
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        // REJECT FAKE DATA!
        const errorMsg = data.message || "Invalid credentials. Unregistered account detected!";
        showToast(errorMsg);
        alert(`ACCESS DENIED:\n\n${errorMsg}`);
        return;
      }

      // Valid registered user!
      currentUser = {
        name: data.name,
        info: data.info || (currentRole === "hospital" ? "Verified Hospital Network" : "LifeLink Volunteer Donor")
      };

      showToast(`Welcome back, ${currentUser.name}!`);
      showScreen("app", "dashboard");
    } catch (err) {
      console.error("Login verification error:", err);
      showToast("Unable to reach backend server. Please make sure backend is running.");
    }
  });

  // Quick Demo Buttons
  document.getElementById("demoDonorBtn").addEventListener("click", () => {
    currentRole = "donor";
    currentUser = { name: "Aarav Sharma", info: "Demo Volunteer Donor" };
    showScreen("app", "dashboard");
  });

  document.getElementById("demoHospitalBtn").addEventListener("click", () => {
    currentRole = "hospital";
    currentUser = { name: "City Memorial Hospital", info: "Demo Emergency Desk" };
    showScreen("app", "dashboard");
  });

  // Donor Registration -> POST /api/donors
  document.getElementById("donorRegForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const donorName = document.getElementById("regDonorName").value.trim();
    const city = document.getElementById("regDonorCity").value.trim();
    const area = document.getElementById("regDonorArea").value.trim();
    const fullArea = city ? `${area}, ${city}` : area;
    const coords = inferCoordsFromArea(fullArea);

    const payload = {
      name: donorName,
      blood_group: document.getElementById("regDonorBlood").value,
      area: fullArea,
      contact_preference: document.getElementById("regDonorContact").value.trim(),
      last_donation_date: document.getElementById("regDonorLastDate").value || "",
      is_visible: document.getElementById("regDonorVisible").checked,
      latitude: coords.latitude,
      longitude: coords.longitude
    };

    try {
      const res = await fetch(`${API_BASE}/api/donors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      currentRole = "donor";
      currentUser = { name: donorName, info: `${payload.blood_group} · ${payload.area}` };
      showToast(`Welcome ${donorName}! Your donor profile is saved.`);
      e.target.reset();
      document.getElementById("regDonorVisible").checked = true;
      showScreen("app", "dashboard");
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
    currentUser = {
      name: hospName,
      info: `Reg ID: ${document.getElementById("regHospRegNo").value.trim()} · ${area}`
    };
    showToast(`Hospital registered! Welcome, ${hospName}.`);
    e.target.reset();
    showScreen("app", "dashboard");
  });

  // Search Donors (Hospital)
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
    const areaVal = document.getElementById("reqArea").value.trim();
    const coords = inferCoordsFromArea(areaVal);

    const payload = {
      blood_group: document.getElementById("reqBlood").value,
      hospital: document.getElementById("reqHospital").value.trim(),
      area: areaVal,
      units_needed: parseInt(document.getElementById("reqUnits").value, 10) || 1,
      contact: document.getElementById("reqContact").value.trim(),
      latitude: coords.latitude,
      longitude: coords.longitude
    };

    try {
      const res = await fetch(`${API_BASE}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      showToast("Emergency request broadcasted & compatible donors alerted!");
      e.target.reset();
      document.getElementById("reqUnits").value = "1";
      await Promise.all([fetchRequests(), fetchAlerts()]);
      navigateTab("requests");
    } catch (err) {
      console.error(err);
      showToast("Could not post request. Check backend connection.");
    }
  });

  // Refresh & Recenter Buttons
  document.getElementById("recenterMapBtn").addEventListener("click", recenterMap);
  document.getElementById("refreshRequestsBtn").addEventListener("click", fetchRequests);
  document.getElementById("refreshAlertsBtn").addEventListener("click", fetchAlerts);

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", () => {
    clearSession();
    showScreen("login");
  });

  // Mobile Menu Drawer
  document.getElementById("mobileMenuBtn").addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("open");
  });

  // Check backend health immediately
  fetch(`${API_BASE}/api/health`)
    .then((r) => setApiStatus(r.ok))
    .catch(() => setApiStatus(false));
});
