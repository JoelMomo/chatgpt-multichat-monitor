const DEFAULTS = {
  monitorEnabled: true,
  monitorShowIdle: false,
  monitorCompact: false,
  monitorAnimations: true
};

const enabled = document.getElementById("enabled");
const showIdle = document.getElementById("showIdle");
const compact = document.getElementById("compact");
const animations = document.getElementById("animations");
const restoreHidden = document.getElementById("restoreHidden");
const clearHistory = document.getElementById("clearHistory");
const historyRoot = document.getElementById("history");

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m";
  return Math.floor(minutes / 60) + "h";
}

function stateLabel(state) {
  return ({
    working: "working",
    attention: "attention",
    error: "error",
    finished: "done",
    interrupted: "stopped"
  })[state] || state || "event";
}

function renderHistory(items) {
  historyRoot.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No recent activity";
    historyRoot.appendChild(empty);
    return;
  }

  for (const item of items.slice(0, 12)) {
    const event = document.createElement("div");
    event.className = "event";
    const top = document.createElement("div");
    top.className = "event-top";
    const state = document.createElement("span");
    state.className = "event-state";
    state.textContent = stateLabel(item.state);
    const title = document.createElement("span");
    title.className = "event-title";
    title.textContent = item.title || "ChatGPT";
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = relativeTime(item.ts) + " ago";
    top.append(state, title, time);
    event.appendChild(top);
    historyRoot.appendChild(event);
  }
}

async function loadHistory() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "monitor-get-history" });
    renderHistory(response?.history || []);
  } catch {
    renderHistory([]);
  }
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  enabled.checked = settings.monitorEnabled !== false;
  showIdle.checked = settings.monitorShowIdle === true;
  compact.checked = settings.monitorCompact === true;
  animations.checked = settings.monitorAnimations !== false;
  await loadHistory();
}

enabled.addEventListener("change", () => {
  chrome.storage.local.set({ monitorEnabled: enabled.checked });
});

showIdle.addEventListener("change", () => {
  chrome.storage.local.set({ monitorShowIdle: showIdle.checked });
});

compact.addEventListener("change", () => {
  chrome.storage.local.set({ monitorCompact: compact.checked });
});

animations.addEventListener("change", () => {
  chrome.storage.local.set({ monitorAnimations: animations.checked });
});

restoreHidden.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "monitor-unhide-all" }).catch(() => {});
  restoreHidden.textContent = "Restored";
  setTimeout(() => { restoreHidden.textContent = "Restore hidden"; }, 1000);
});

clearHistory.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "monitor-clear-history" }).catch(() => {});
  renderHistory([]);
});

load();
