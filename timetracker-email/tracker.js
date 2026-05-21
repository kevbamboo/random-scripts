const STATE_KEY = "tracker_state";
const DATA_KEY = "tracker_data";

let lock = false;

/* ---------------- TIME HELPERS ---------------- */

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

/* ---------------- DOMAIN ---------------- */

function getDomain(url) {
  try {
    if (
      !url ||
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")
    )
      return null;

    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/* ---------------- STORAGE ---------------- */

async function getState() {
  const res = await chrome.storage.local.get([STATE_KEY]);
  return res[STATE_KEY] || { currentSite: null, startedAt: null };
}

async function setState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function addTime(site, seconds) {
  if (!site || seconds <= 0) return;

  const res = await chrome.storage.local.get([DATA_KEY]);
  const data = res[DATA_KEY] || {};

  data[site] = (data[site] || 0) + seconds;

  await chrome.storage.local.set({ [DATA_KEY]: data });
}

/* ---------------- TRACKING CORE ---------------- */

async function flushTime() {
  const state = await getState();

  if (!state.currentSite || !state.startedAt) return;

  const elapsed = nowSec() - state.startedAt;

  if (elapsed <= 0) return;

  await addTime(state.currentSite, elapsed);

  await setState({
    currentSite: state.currentSite,
    startedAt: nowSec(),
  });
}

async function switchSite(site) {
  if (!site || lock) return;

  lock = true;

  try {
    const state = await getState();

    if (state.currentSite === site) return;

    await flushTime();

    await setState({
      currentSite: site,
      startedAt: nowSec(),
    });
  } finally {
    lock = false;
  }
}

/* ---------------- REPORT ---------------- */

async function buildReport() {
  const res = await chrome.storage.local.get([DATA_KEY]);
  const data = res[DATA_KEY] || {};

  const entries = Object.entries(data)
    .map(([site, sec]) => [site, sec])
    .filter(([_, sec]) => sec >= 60) // >= 1 minute only
    .sort((a, b) => b[1] - a[1]);

  // ---- BIG 3 tracking ----
  let youtube = 0;
  let reddit = 0;
  let instagram = 0;

  for (const [site, sec] of Object.entries(data)) {
    const minutes = sec / 60;

    if (site.includes("youtube.com") || site.includes("youtu.be")) {
      youtube += minutes;
    }
    if (site.includes("reddit.com")) {
      reddit += minutes;
    }
    if (site.includes("instagram.com")) {
      instagram += minutes;
    }
  }

  // ---- BUILD EMAIL ----
  let body = "Big 3 Wasters:\n--------------\n";

  body += `YouTube: ${Math.round(youtube)} min\n`;
  body += `Reddit: ${Math.round(reddit)} min\n`;
  body += `Instagram: ${Math.round(instagram)} min\n\n`;
  body += "===========================\n\n";
  body += "Web browsing summary:\n---------------------\n";

  for (const [site, sec] of entries) {
    const isBig3 =
      site.includes("youtube.com") ||
      site.includes("youtu.be") ||
      site.includes("reddit.com") ||
      site.includes("instagram.com");

    // skip Big 3 from general summary
    if (isBig3) continue;

    const mins = Math.round(sec / 60);
    const cleanSite = site.replace(/^www\./, "");

    body += `${cleanSite}: ${mins} min\n`;
  }

  body += "\n===========================\n\n";
  body += "Notes:";

  return body;
}

/* ---------------- EMAIL (mailto) ---------------- */

async function sendEmail() {
  const now = new Date();

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const subject = `Web Surfing: ${formatDate(now)} ${time}`;

  const body = await buildReport();

  const url =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent("hello@example.com")}` +
    `&su=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  chrome.tabs.create({ url });
}

/* ---------------- TAB TRACKING ---------------- */

async function trackActiveTab() {
  const windows = await chrome.windows.getAll({ populate: true });

  const focused = windows.find((w) => w.focused);

  if (!focused) {
    await flushTime();
    await setState({ currentSite: null, startedAt: null });
    return;
  }

  const tab = focused.tabs.find((t) => t.active);

  if (!tab) return;

  const site = getDomain(tab.url);

  if (!site) return;

  await switchSite(site);
}

/* ---------------- EVENTS ---------------- */

chrome.tabs.onActivated.addListener(trackActiveTab);

chrome.tabs.onUpdated.addListener((_, info, tab) => {
  if (tab.active && info.status === "complete") {
    trackActiveTab();
  }
});

chrome.windows.onFocusChanged.addListener(trackActiveTab);

/* ---------------- 10PM SCHEDULER ---------------- */

function schedule10pm() {
  const now = new Date();
  const next = new Date();

  next.setHours(17, 47, 0, 0);

  if (now > next) {
    next.setDate(next.getDate() + 1);
  }

  chrome.alarms.create("dailyReport", {
    when: next.getTime(),
  });
}

/* ---------------- ALARMS ---------------- */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "dailyReport") return;

  await flushTime();
  await sendEmail();

  // reschedule next day (important fix)
  schedule10pm();
});

/* ---------------- STARTUP SAFETY ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  schedule10pm();
  trackActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  schedule10pm();
  trackActiveTab();
});
