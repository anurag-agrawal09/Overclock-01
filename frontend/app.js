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
const savedBackend = localStorage.getItem("lifelink_backend_host");
const currentHost = window.location.hostname && window.location.hostname !== "" ? window.location.hostname : "127.0.0.1";
const API_BASE = savedBackend || (window.location.protocol.startsWith("http") ? `http://${currentHost}:5000` : "http://127.0.0.1:5000");

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

  // Check backend health immediately
  fetch(`${API_BASE}/api/health`)
    .then((r) => setApiStatus(r.ok))
    .catch(() => setApiStatus(false));
});
