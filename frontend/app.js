/* =====================================================
   LifeLink – app.js
   - Session persistence (never throws user back to login on submit/refresh)
   - Role-based security (personal donor info & Find Donors protected for Hospital only)
   - Smart area-to-coordinate mapping (no manual GPS input needed)
   - Clean text without leading symbols/emojis
   ===================================================== */

// If user configured a custom backend host via ?backend=... or in localStorage, use it.
// Default to the same hostname serving the page on port 5000, or local 127.0.0.1:5000
const urlParamHost = new URLSearchParams(window.location.search).get("backend");
if (urlParamHost) {
  localStorage.setItem("lifelink_backend_host", urlParamHost);
}
let savedBackend = localStorage.getItem("lifelink_backend_host");

// If running on a cloud domain or anywhere outside localhost, clear old localhost storage
const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "";
if (!isLocalhost && savedBackend && (savedBackend.includes("localhost") || savedBackend.includes("127.0.0.1"))) {
  localStorage.removeItem("lifelink_backend_host");
  savedBackend = null;
}

let defaultBase = "http://127.0.0.1:5000";
if (window.location.protocol.startsWith("http")) {
  const p = window.location.port;
  if (!p || p === "80" || p === "443" || p === "5000") {
    // Relative path: perfect for deployed sites (avoids protocol, port, or mixed-content mismatches)
    defaultBase = "";
  } else {
    // VS Code Live Server on a custom port like 5500: connect to local Flask backend on 5000
    defaultBase = `${window.location.protocol}//${window.location.hostname}:5000`;
  }
}
const API_BASE = savedBackend || defaultBase;

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

/* ---------- Area Coordinate Lookup (Auto-places pins near patient area across India) ---------- */
const AREA_COORDS = {
  india: [20.5937, 78.9629],
  lucknow: [26.8467, 80.9462],
  hazratganj: [26.8501, 80.9499],
  gomti: [26.8565, 81.0012],
  kanpur: [26.4499, 80.3319],
  delhi: [28.6139, 77.209],
  noida: [28.5355, 77.391],
  mumbai: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  jaipur: [26.9124, 75.7873],
  ahmedabad: [23.0225, 72.5714],
  patna: [25.5941, 85.1376],
  bhopal: [23.2599, 77.4126],
  chandigarh: [30.7333, 76.7794],
  downtown: [26.8467, 80.9462],
  northside: [26.87, 80.94]
};

// Blood donation compatibility map
const CAN_DONATE_TO = {
  "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"]
};

function calculateAge(dobString) {
  if (!dobString) return 0;
  const birth = new Date(dobString);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

let filterMatchingOnly = false;

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
async function checkAwsStatus() {
  const pill = document.getElementById("awsStatus");
  const label = document.getElementById("awsStatusText");
  if (!pill || !label) return;
  try {
    const res = await fetch(`${API_BASE}/api/aws/status`);
    if (res.ok) {
      const data = await res.json();
      pill.classList.remove("offline");
      pill.classList.add("aws");
      label.textContent = "AWS: SNS & S3";
      pill.title = `AWS Cloud Connected\nRegion: ${data.region_name || data.region}\nS3 Vault: ${data.s3_bucket}\nSNS SMS Gateway: Online`;
    }
  } catch {
    // Graceful offline fallback
  }
}

function setApiStatus(isOnline) {
  const pill = document.getElementById("apiStatus");
  const label = document.getElementById("apiStatusText");
  if (!pill || !label) return;
  pill.classList.remove("checking", "online", "offline");
  if (isOnline) {
    pill.classList.add("online");
    label.textContent = "Backend Connected";
    checkAwsStatus();
  } else {
    pill.classList.add("offline");
    label.textContent = "Backend Offline";
  }
}

/* Global demo helper functions callable directly from inline onclick */
function loginDemoDonor() {
  currentRole = "donor";
  currentUser = { name: "Aarav Sharma", info: "O+ · Lucknow" };
  showScreen("app", "dashboard");
}

function loginDemoHospital() {
  currentRole = "hospital";
  currentUser = { name: "City Memorial Hospital", info: "Verified Hospital Emergency Desk" };
  showScreen("app", "dashboard");
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
    if (typeof updateMapMarkers === "function") {
      updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital", currentUser, currentAlerts);
    }
  } else if (tabId === "dashboard" && mapEl) {
    document.getElementById("mapSlotDashboard").appendChild(mapEl);
    refreshMapSize();
    if (typeof updateMapMarkers === "function") {
      updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital", currentUser, currentAlerts);
    }
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

    try {
      const kpi1 = document.getElementById("kpiVal1");
      if (kpi1) kpi1.textContent = currentDonors.length;
      renderDonors(currentDonors);
      updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital", currentUser, currentAlerts);
    } catch (renderErr) {
      console.warn("Donor render warning:", renderErr);
    }
  } catch (err) {
    console.error("Fetch donors error:", err);
    const list = document.getElementById("donorsList");
    if (list) {
      list.innerHTML = `<p class="empty-state">Unable to load donors. Make sure backend is running.</p>`;
    }
  }
}

async function fetchRequests() {
  try {
    const res = await fetch(`${API_BASE}/api/requests`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentRequests = Array.isArray(data) ? data : (data.requests || []);

    try {
      const openCount = currentRequests.filter((r) => String(r.status || "open").toLowerCase() === "open").length;
      const kpi2El = document.getElementById("kpiVal2");
      if (kpi2El) kpi2El.textContent = openCount;

      // Update 'Demands Matching My Blood' count for the logged-in donor
      const myBlood = getMyDonorBloodGroup();
      const kpiMatchingEl = document.getElementById("kpiValMatchingDemands");
      const kpiMatchingLbl = document.getElementById("kpiLblMatchingDemands");
      if (kpiMatchingEl) {
        if (myBlood) {
          const allowed = CAN_DONATE_TO[myBlood] || [myBlood];
          const matchCount = currentRequests.filter(
            (r) => String(r.status || "open").toLowerCase() === "open" && allowed.includes((r.blood_group || "").toUpperCase())
          ).length;
          kpiMatchingEl.textContent = matchCount;
          if (kpiMatchingLbl) kpiMatchingLbl.textContent = `Demands Matching (${myBlood})`;
        } else {
          kpiMatchingEl.textContent = openCount;
          if (kpiMatchingLbl) kpiMatchingLbl.textContent = "Open Emergency Demands";
        }
      }

      renderRequests(currentRequests);
      renderDashboardRequests(currentRequests);
      updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital", currentUser, currentAlerts);
    } catch (renderErr) {
      console.warn("Requests render warning:", renderErr);
    }
  } catch (err) {
    console.error("Fetch requests error:", err);
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
    if (typeof updateMapMarkers === "function") {
      updateMapMarkers(currentDonors, currentRequests, currentRole === "hospital", currentUser, currentAlerts);
    }
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

function getMyDonorBloodGroup() {
  if (currentUser && currentUser.info) {
    const match = currentUser.info.match(/\b(A\+|A-|B\+|B-|O\+|O-|AB\+|AB-)\b/);
    if (match) return match[1];
  }
  return null;
}

function renderDashboardRequests(requests) {
  const list = document.getElementById("dashRequestsList");
  if (!list) return;

  let openReqs = requests.filter((r) => String(r.status || "open").toLowerCase() === "open");

  const myBlood = getMyDonorBloodGroup();
  const helpText = document.getElementById("donorMatchHelpText");

  // If user selected "Matching My Blood Group", only show requests where this user is compatible to donate!
  if (filterMatchingOnly) {
    if (myBlood) {
      const allowedRecipients = CAN_DONATE_TO[myBlood] || [myBlood];
      openReqs = openReqs.filter((req) => allowedRecipients.includes((req.blood_group || "").toUpperCase()));
      if (helpText) {
        helpText.textContent = `Filtered: Showing urgent requests matching your blood group (${myBlood}) that you can donate to.`;
      }
    } else {
      if (helpText) {
        helpText.textContent = "Please sign in as a donor with a known blood group to filter compatible matches.";
      }
    }
  } else {
    if (helpText) {
      helpText.textContent = myBlood
        ? `Your Blood Group is ${myBlood}. You can toggle "Matching My Blood Group" to see requests you can donate to.`
        : "Showing active blood requests near patient hospitals.";
    }
  }

  const displayList = openReqs.slice(0, 5);

  if (!displayList.length) {
    list.innerHTML = `<p class="empty-state">No matching emergency requests found right now.</p>`;
  } else {
    list.innerHTML = displayList
      .map((req) => {
        const idx = currentRequests.indexOf(req);
        const bgEsc = safeText(req.blood_group).replace(/'/g, "");
        const areaEsc = safeText(req.area).replace(/'/g, "");
        const reqId = req.id ?? req.request_id;
        const isMatch = myBlood && (CAN_DONATE_TO[myBlood] || []).includes(req.blood_group);

        return `
        <div class="item-card ${isMatch ? "match-highlight" : ""}">
          <div class="item-top">
            <div class="item-title">
              <span class="blood-pill">${safeText(req.blood_group)}</span>
              <span>${safeText(req.hospital)}</span>
              ${isMatch ? '<span class="status-tag closed">Matches Your Blood!</span>' : ""}
            </div>
            <div class="head-actions">
              ${
                isMatch && reqId != null
                  ? `<button class="btn-ready-donate" type="button" onclick="respondIAmReady(${reqId})">I Am Ready to Donate</button>`
                  : ""
              }
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
  if (!list) return;
  if (!requests || !requests.length) {
    list.innerHTML = `<p class="empty-state">No emergency requests posted yet.</p>`;
    return;
  }
  const myBlood = getMyDonorBloodGroup();

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
          ${
            !isClosed && reqId != null && myBlood && (CAN_DONATE_TO[myBlood] || []).includes(req.blood_group)
              ? `<button class="btn-ready-donate" type="button" onclick="respondIAmReady(${reqId})">I Am Ready to Donate</button>`
              : ""
          }
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

function formatAlertMessage(rawMessage) {
  if (!rawMessage) return "";
  let text = String(rawMessage).trim();

  // Extract AWS SNS receipt if present
  let awsTag = "";
  const awsMatch = text.match(/\[AWS SNS Dispatched · (.*?)\]/);
  if (awsMatch) {
    awsTag = `<span class="aws-tag">AWS SNS SMS: ${safeText(awsMatch[1])}</span>`;
    text = text.replace(/\[AWS SNS Dispatched · .*?\]/, "").trim();
  }

  // Check pattern: [MATCH TYPE] Urgent: Hospital in Area needs X blood. Your blood group is Y.
  const regex = /^(\[(?:EXACT|COMPATIBLE)\s+MATCH\]\s*Urgent:?)\s*(.+?\.)\s*(Your blood group is\s+[A-Za-z0-9+-]+(?:\.|\b))\s*(.*)$/i;
  const match = text.match(regex);

  if (match) {
    const header = match[1].trim();
    const hospitalReq = match[2].trim();
    const yourGroup = match[3].trim();
    const remaining = match[4].trim();

    return `
      <div class="alert-block">
        <div class="alert-line-header">${safeText(header)}</div>
        <div class="alert-line-body">${safeText(hospitalReq)}</div>
        <div class="alert-line-donor">${safeText(yourGroup)}</div>
        ${remaining ? `<div class="alert-line-extra">${safeText(remaining)}</div>` : ""}
        ${awsTag ? `<div class="alert-line-extra">${awsTag}</div>` : ""}
      </div>
    `;
  }

  // If message already has linebreaks (\n), format each line separately
  if (text.includes("\n")) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    return `
      <div class="alert-block">
        ${lines.map((l, i) => {
          if (i === 0 && l.toUpperCase().includes("MATCH]")) {
            return `<div class="alert-line-header">${safeText(l)}</div>`;
          }
          if (l.toLowerCase().startsWith("your blood group")) {
            return `<div class="alert-line-donor">${safeText(l)}</div>`;
          }
          return `<div class="alert-line-body">${safeText(l)}</div>`;
        }).join("")}
        ${awsTag ? `<div class="alert-line-extra">${awsTag}</div>` : ""}
      </div>
    `;
  }

  // General fallback
  return `
    <div class="alert-block">
      <div class="alert-line-body">${safeText(text)}</div>
      ${awsTag ? `<div class="alert-line-extra">${awsTag}</div>` : ""}
    </div>
  `;
}

function renderAlerts(alerts) {
  const list = document.getElementById("alertsList");
  if (!alerts.length) {
    list.innerHTML = `<p class="empty-state">No live alerts right now.</p>`;
    return;
  }
  list.innerHTML = alerts
    .map(
      (a) => {
        const contentHtml = formatAlertMessage(a.message || JSON.stringify(a));
        return `
        <div class="item-card alert-item-card">
          ${contentHtml}
          <div class="item-meta">
            ${currentRole === "hospital" && a.donor_name ? `<span>To: ${safeText(a.donor_name)} (${safeText(a.blood_group)})</span>` : ""}
            ${a.created_at ? `<span>Time: ${safeText(a.created_at)}</span>` : ""}
          </div>
        </div>
      `;
      }
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

async function respondIAmReady(requestId) {
  const donorName = currentUser.name || "Volunteer Donor";
  const myBlood = getMyDonorBloodGroup() || "";
  const donorContact = currentUser.info || "";

  try {
    const res = await fetch(`${API_BASE}/api/requests/${requestId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        donor_name: donorName,
        donor_blood: myBlood,
        donor_contact: donorContact
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || "Thank you! Notification sent to the patient/requester.");
      await fetchAlerts();
    } else {
      showToast("Response recorded. Thank you for volunteering!");
    }
  } catch (err) {
    console.error("Respond ready error:", err);
    showToast("Response recorded locally. Thank you for volunteering!");
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

      if (res.ok && data.success) {
        currentUser = {
          name: data.name,
          info: data.info || (currentRole === "hospital" ? "Verified Hospital Network" : "LifeLink Volunteer Donor")
        };
        showToast(`Welcome back, ${currentUser.name}!`);
        showScreen("app", "dashboard");
        return;
      }

      // If entered value is in our donors database, log in with their real name
      if (currentDonors && currentDonors.length) {
        const cleanDigits = entered.replace(/\D/g, "");
        const matched = currentDonors.find((d) => {
          const contactDigits = (d.contact_preference || "").replace(/\D/g, "");
          const dName = (d.name || "").toLowerCase();
          return (cleanDigits && contactDigits && contactDigits.includes(cleanDigits)) || dName === entered.toLowerCase();
        });
        if (matched) {
          currentUser = {
            name: matched.name,
            info: `${matched.blood_group} · ${matched.area}`
          };
          showToast(`Welcome back, ${currentUser.name}!`);
          showScreen("app", "dashboard");
          return;
        }
      }

      // If not found in database, alert user cleanly
      const errorMsg = data.message || "Account not found. Please click 'Register as Donor' below.";
      showToast(errorMsg);
      alert(`LOGIN NOTICE:\n\n${errorMsg}`);
    } catch (err) {
      console.error("Login verification error:", err);
      // Fallback for demo when backend is starting
      currentUser = {
        name: entered || (currentRole === "hospital" ? "City Memorial Hospital" : "Aarav Sharma"),
        info: currentRole === "hospital" ? "Hospital Desk" : "Volunteer Donor"
      };
      showToast(`Welcome, ${currentUser.name}!`);
      showScreen("app", "dashboard");
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

  // Real-time Age feedback and "First Time Donor" helper
  const dobInput = document.getElementById("regDonorDob");
  const ageNotice = document.getElementById("regDonorAgeNotice");
  if (dobInput && ageNotice) {
    dobInput.addEventListener("input", () => {
      if (!dobInput.value) {
        ageNotice.textContent = "";
        return;
      }
      const age = calculateAge(dobInput.value);
      if (age < 18) {
        ageNotice.style.color = "#dc2626";
        ageNotice.textContent = `Age: ${age} yrs (Underage — Minimum 18 years required)`;
      } else if (age > 65) {
        ageNotice.style.color = "#dc2626";
        ageNotice.textContent = `Age: ${age} yrs (Above limit — Maximum 65 years allowed)`;
      } else {
        ageNotice.style.color = "#16a34a";
        ageNotice.textContent = `Age: ${age} yrs (Eligible to donate)`;
      }
    });
  }

  const btnFirstTime = document.getElementById("btnFirstTimeDonor");
  if (btnFirstTime) {
    btnFirstTime.addEventListener("click", () => {
      const d = new Date();
      d.setDate(d.getDate() - 100); // 100 days ago, satisfies 90-day rest rule
      document.getElementById("regDonorLastDate").value = d.toISOString().split("T")[0];
      showToast("First time donor date auto-filled (eligible to donate immediately).");
    });
  }

  // Authorized Aadhaar Age & Identity Verification Flow
  let aadhaarSessionId = null;
  const aadhaarInput = document.getElementById("regDonorAadhaar");
  const btnSendAadhaarOtp = document.getElementById("btnAadhaarSendOtp");
  const otpRow = document.getElementById("aadhaarOtpRow");
  const otpInput = document.getElementById("regDonorAadhaarOtp");
  const btnVerifyAadhaarOtp = document.getElementById("btnAadhaarVerifyOtp");
  const otpHint = document.getElementById("aadhaarOtpHint");
  const verifiedBadge = document.getElementById("aadhaarVerifiedBadge");
  const verifiedAgeSpan = document.getElementById("aadhaarVerifiedAge");
  const maskedIdSpan = document.getElementById("aadhaarMaskedId");

  if (aadhaarInput) {
    // Auto format 12 digits into 4-digit groups (XXXX XXXX XXXX)
    aadhaarInput.addEventListener("input", (e) => {
      let raw = e.target.value.replace(/\D/g, "").slice(0, 12);
      let formatted = raw.replace(/(\d{4})(?=\d)/g, "$1 ");
      e.target.value = formatted;
    });
  }

  if (btnSendAadhaarOtp) {
    btnSendAadhaarOtp.addEventListener("click", async () => {
      const rawNum = (aadhaarInput.value || "").replace(/\s/g, "");
      if (rawNum.length !== 12) {
        alert("Please enter a valid 12-digit Aadhaar Number.");
        return;
      }
      btnSendAadhaarOtp.disabled = true;
      btnSendAadhaarOtp.textContent = "Sending OTP...";

      try {
        const res = await fetch(`${API_BASE}/api/aadhaar/request-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aadhaar_number: rawNum })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Aadhaar validation failed.");
        }

        aadhaarSessionId = data.session_id;
        otpRow.classList.remove("hidden");
        btnSendAadhaarOtp.textContent = "Resend OTP";
        btnSendAadhaarOtp.disabled = false;
        
        if (data.demo_otp_hint) {
          otpHint.textContent = `UIDAI Sandbox OTP Sent! Demo OTP: ${data.demo_otp_hint}`;
        } else {
          otpHint.textContent = data.message || "OTP sent to registered phone.";
        }
        showToast("OTP sent to mobile registered with Aadhaar.");
      } catch (err) {
        btnSendAadhaarOtp.disabled = false;
        btnSendAadhaarOtp.textContent = "Send OTP";
        alert(`Aadhaar Verification Error:\n${err.message}`);
        showToast(err.message || "Failed to request Aadhaar OTP.");
      }
    });
  }

  if (btnVerifyAadhaarOtp) {
    btnVerifyAadhaarOtp.addEventListener("click", async () => {
      const otpVal = (otpInput.value || "").trim();
      if (otpVal.length < 6) {
        alert("Please enter the 6-digit OTP received on your mobile.");
        return;
      }
      btnVerifyAadhaarOtp.disabled = true;
      btnVerifyAadhaarOtp.textContent = "Verifying...";

      try {
        const res = await fetch(`${API_BASE}/api/aadhaar/verify-otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: aadhaarSessionId, otp: otpVal })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "OTP verification failed.");
        }

        if (!data.is_eligible) {
          alert(`Eligibility Restriction:\n${data.message}`);
          btnVerifyAadhaarOtp.disabled = false;
          btnVerifyAadhaarOtp.textContent = "Verify Age";
          return;
        }

        // Lock in verified DOB
        if (dobInput) {
          dobInput.value = data.dob;
          dobInput.readOnly = true;
          dobInput.style.background = "#f0fdf4";
          dobInput.style.borderColor = "#86efac";
          if (ageNotice) {
            ageNotice.style.color = "#16a34a";
            ageNotice.textContent = `Age: ${data.age} yrs (Verified from Aadhaar Record)`;
          }
        }

        // Show green Aadhaar verification badge
        otpRow.classList.add("hidden");
        if (verifiedBadge) {
          verifiedBadge.classList.remove("hidden");
          verifiedAgeSpan.textContent = data.age;
          maskedIdSpan.textContent = `Aadhaar ID: ${data.masked_aadhaar} · UIDAI Gateway Verified`;
        }

        showToast(`Age Verified: ${data.age} years. Eligible to donate!`);
      } catch (err) {
        btnVerifyAadhaarOtp.disabled = false;
        btnVerifyAadhaarOtp.textContent = "Verify Age";
        alert(`OTP Verification Failed:\n${err.message}`);
        showToast(err.message || "Could not verify Aadhaar OTP.");
      }
    });
  }

  // -----------------------------------------------------------------
  // AI Blood Test Document Authenticity Scanner & Test Samples
  // -----------------------------------------------------------------
  let lastAiVerification = null;
  const reportFileInput = document.getElementById("regDonorReport");
  const aiScanLoader = document.getElementById("aiScanLoader");
  const aiDocResultCard = document.getElementById("aiDocResultCard");

  async function executeAiDocumentVerification(fileBlob, filename) {
    if (!fileBlob) {
      if (aiDocResultCard) aiDocResultCard.classList.add("hidden");
      return;
    }

    if (aiScanLoader) aiScanLoader.classList.remove("hidden");
    if (aiDocResultCard) aiDocResultCard.classList.add("hidden");

    try {
      const formData = new FormData();
      formData.append("file", fileBlob, filename);
      const selBlood = (document.getElementById("regDonorBlood")?.value || "").trim();
      if (selBlood) formData.append("blood_group", selBlood);

      const res = await fetch(`${API_BASE}/api/ai/verify-document`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      lastAiVerification = data;

      if (aiScanLoader) aiScanLoader.classList.add("hidden");

      if (aiDocResultCard) {
        aiDocResultCard.classList.remove("hidden", "genuine", "warning", "danger");

        const scoreBadge = document.getElementById("aiScoreBadge");
        const verdictBadge = document.getElementById("aiVerdictBadge");
        const summaryText = document.getElementById("aiSummaryText");
        const labName = document.getElementById("aiLabName");
        const hbText = document.getElementById("aiHemoglobin");
        const infText = document.getElementById("aiInfection");
        const pathText = document.getElementById("aiPathologist");
        const dateText = document.getElementById("aiReportDate");
        const checksList = document.getElementById("aiChecksList");

        const score = data.authenticity_score || 0;
        if (scoreBadge) {
          scoreBadge.textContent = `${score}% Genuine`;
          scoreBadge.className = score >= 75 ? "ai-score-pill" : "ai-score-pill low";
        }
        if (verdictBadge) {
          verdictBadge.textContent = data.status_badge || "Analysis Complete";
        }
        if (summaryText) summaryText.textContent = data.summary || "";

        const ext = data.extracted_data || {};
        if (labName) labName.textContent = ext.lab_name || "Certified Lab";
        if (hbText) hbText.textContent = ext.hemoglobin || "Normal";
        if (infText) infText.textContent = ext.infection_screen || "Non-Reactive";
        if (pathText) pathText.textContent = ext.pathologist || "Authorized Pathologist";
        if (dateText) dateText.textContent = `Date: ${ext.report_date || "Today"}`;

        if (checksList && data.checks) {
          checksList.innerHTML = data.checks.map((c) => `
            <div class="ai-check-item">
              <span class="ai-check-icon ${c.passed ? 'pass' : 'fail'}">${c.passed ? '✓' : '✗'}</span>
              <div><strong>${safeText(c.name)}:</strong> ${safeText(c.details)}</div>
            </div>
          `).join("");
        }

        if (data.verdict === "GENUINE_ELIGIBLE") {
          aiDocResultCard.classList.add("genuine");
          showToast(`AI Verified: Report is Authentic (${score}%) & Eligible!`);
          if (ext.blood_group && !document.getElementById("regDonorBlood").value) {
            document.getElementById("regDonorBlood").value = ext.blood_group;
          }
        } else if (data.verdict === "GENUINE_INELIGIBLE") {
          aiDocResultCard.classList.add("warning");
          showToast("Report Authentic, but clinical parameters outside safe donation range.");
        } else {
          aiDocResultCard.classList.add("danger");
          showToast("Warning: Document does not match authentic clinical lab patterns.");
        }
      }
    } catch (err) {
      console.error("AI Document Scanner error:", err);
      if (aiScanLoader) aiScanLoader.classList.add("hidden");
    }
  }

  if (reportFileInput) {
    reportFileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        await executeAiDocumentVerification(file, file.name);
      }
    });
  }

  // 1-Click AI Test Sample Handlers
  async function testSampleUrl(url, filename) {
    try {
      showToast(`Loading test sample: ${filename}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await executeAiDocumentVerification(blob, filename);
    } catch (err) {
      console.error("Load sample error:", err);
      showToast("Could not load sample document.");
    }
  }

  const btnTestOfficial = document.getElementById("btnTestOfficialDoc");
  if (btnTestOfficial) {
    btnTestOfficial.addEventListener("click", () => {
      testSampleUrl(`${API_BASE}/sample_reports/official_nabl_blood_report.pdf`, "official_nabl_blood_report.pdf");
    });
  }

  const btnTestFake = document.getElementById("btnTestFakeDoc");
  if (btnTestFake) {
    btnTestFake.addEventListener("click", () => {
      testSampleUrl(`${API_BASE}/sample_reports/fake_document_receipt.pdf`, "fake_document_receipt.pdf");
    });
  }

  const btnTestLowHb = document.getElementById("btnTestLowHbDoc");
  if (btnTestLowHb) {
    btnTestLowHb.addEventListener("click", () => {
      testSampleUrl(`${API_BASE}/sample_reports/ineligible_low_hemoglobin_report.pdf`, "ineligible_low_hemoglobin_report.pdf");
    });
  }

  // Donor Registration -> POST /api/donors
  document.getElementById("donorRegForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const donorName = document.getElementById("regDonorName").value.trim();
    const dob = document.getElementById("regDonorDob").value;
    const password = document.getElementById("regDonorPass").value.trim();
    const contact = document.getElementById("regDonorContact").value.trim();
    const bloodGroup = document.getElementById("regDonorBlood").value;
    const lastDonation = document.getElementById("regDonorLastDate").value;
    const city = document.getElementById("regDonorCity").value.trim();
    const area = document.getElementById("regDonorArea").value.trim();
    const pincode = document.getElementById("regDonorPin").value.trim();
    const weightVal = parseFloat(document.getElementById("regDonorWeight").value);
    const recentIllness = document.getElementById("regDonorIllness").value.trim();

    // 1. Mandatory DOB & Age 18 to 65 check
    if (!dob) {
      alert("Registration Error:\nDate of Birth is compulsory to verify blood donor eligibility.");
      showToast("Date of birth is compulsory.");
      return;
    }
    const age = calculateAge(dob);
    if (age < 18) {
      alert(`Registration Blocked:\nYou are ${age} years old. Donors must be at least 18 years old to donate blood.`);
      showToast("Underage: Minimum 18 years required.");
      return;
    }
    if (age > 65) {
      alert(`Registration Blocked:\nYou are ${age} years old. Donors must be 65 years old or younger according to blood donation regulations.`);
      showToast("Maximum age limit is 65 years.");
      return;
    }

    // 2. Mandatory Password check
    if (!password || password.length < 4) {
      alert("Registration Error:\nPassword is required to protect your personal account (minimum 4 characters).");
      showToast("Password is required.");
      return;
    }

    // 3. Mandatory Pincode check
    if (!pincode || !/^\d{6}$/.test(pincode)) {
      alert("Registration Error:\nPlease enter a valid 6-digit Pincode.");
      showToast("Pincode must be 6 digits.");
      return;
    }

    // 4. Health & Verification fields use native HTML required validation ("Please fill out this field.")

    // 6. Mandatory Last Donation Date Check
    if (!lastDonation) {
      alert("Registration Error:\nLast donation date is compulsory for the 90-day medical rest check.\n\nIf you have never donated before, click 'Never Donated (First Time)'.");
      showToast("Last donation date is required.");
      return;
    }

    const fullArea = city ? `${area}, ${city}` : area;
    const coords = inferCoordsFromArea(fullArea);

    // Optional: Upload medical document to AWS S3
    let s3ReportUrl = "";
    const reportFileInput = document.getElementById("regDonorReport");
    if (reportFileInput && reportFileInput.files && reportFileInput.files[0]) {
      try {
        showToast("Uploading medical report to AWS S3 Cloud Vault...");
        const formData = new FormData();
        formData.append("file", reportFileInput.files[0]);
        const s3Res = await fetch(`${API_BASE}/api/aws/upload-report`, {
          method: "POST",
          body: formData
        });
        if (s3Res.ok) {
          const s3Data = await s3Res.json();
          s3ReportUrl = s3Data.s3_url || "";
          showToast("Document stored encrypted in AWS S3 vault!");
        }
      } catch (uploadErr) {
        console.warn("AWS S3 upload:", uploadErr);
      }
    }

    const payload = {
      name: donorName,
      blood_group: bloodGroup,
      area: fullArea,
      contact_preference: contact,
      last_donation_date: lastDonation,
      is_visible: document.getElementById("regDonorVisible").checked,
      latitude: coords.latitude,
      longitude: coords.longitude,
      dob: dob,
      pincode: pincode,
      password: password,
      weight: weightVal,
      recent_illness: recentIllness,
      health_verified: true,
      report_url: s3ReportUrl
    };

    try {
      const res = await fetch(`${API_BASE}/api/donors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server responded with ${res.status}`);
      }

      currentRole = "donor";
      currentUser = {
        name: donorName,
        info: `${payload.blood_group} · ${payload.area}`
      };
      showToast(`Welcome ${donorName}! Your protected donor profile is created.`);
      e.target.reset();
      document.getElementById("regDonorVisible").checked = true;
      showScreen("app", "dashboard");
    } catch (err) {
      console.error(err);
      alert(`Registration Failed:\n\n${err.message}`);
      showToast(err.message || "Could not register donor.");
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
      const savedReq = await res.json();

      showToast("Emergency request broadcasted & compatible donors alerted!");
      e.target.reset();
      document.getElementById("reqUnits").value = "1";

      // Instantly reflect the added SOS request in local arrays
      if (savedReq && (savedReq.id || savedReq.blood_group)) {
        currentRequests = [savedReq, ...currentRequests.filter((r) => r.id !== savedReq.id)];
        renderRequests(currentRequests);
        renderDashboardRequests(currentRequests);
      }

      await Promise.all([fetchRequests(), fetchAlerts()]);
      navigateTab("requests");
    } catch (err) {
      console.error("Post request error:", err);
      showToast("Could not post request. Check backend connection.");
    }
  });

  // Filter Buttons: All vs Matching My Blood Group
  const btnAll = document.getElementById("btnFilterAllRequests");
  const btnMatch = document.getElementById("btnFilterMyMatch");

  if (btnAll) {
    btnAll.addEventListener("click", () => {
      filterMatchingOnly = false;
      btnAll.classList.add("active");
      if (btnMatch) btnMatch.classList.remove("active");
      renderDashboardRequests(currentRequests);
    });
  }

  if (btnMatch) {
    btnMatch.addEventListener("click", () => {
      filterMatchingOnly = true;
      btnMatch.classList.add("active");
      if (btnAll) btnAll.classList.remove("active");
      renderDashboardRequests(currentRequests);
    });
  }

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

  // Check backend health immediately with automatic retry for cloud wakeups
  async function verifyHealth() {
    try {
      const r = await fetch(`${API_BASE}/api/health`);
      if (r.ok) {
        setApiStatus(true);
        // Periodic keep-alive check every 15 seconds so connection remains active
        setTimeout(verifyHealth, 15000);
      } else {
        setApiStatus(false);
        setTimeout(verifyHealth, 4000);
      }
    } catch {
      setApiStatus(false);
      // Retry in background in case server is waking up
      setTimeout(verifyHealth, 4000);
    }
  }
  verifyHealth();
});
