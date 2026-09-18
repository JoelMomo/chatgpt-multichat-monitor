const DEFAULTS = {
  monitorEnabled: true,
  monitorShowIdle: false,
  monitorCompact: false,
  monitorAnimations: true,
  monitorSoundsEnabled: true,
  monitorSoundDone: "off",
  monitorSoundRetry: "potion",
  monitorSoundAttention: "point",
  monitorSoundError: "chan",
  monitorSoundVolume: 0.8
};

const enabled = document.getElementById("enabled");
const showIdle = document.getElementById("showIdle");
const compact = document.getElementById("compact");
const animations = document.getElementById("animations");
const restoreHidden = document.getElementById("restoreHidden");
const clearHistory = document.getElementById("clearHistory");
const historyRoot = document.getElementById("history");

const soundsEnabled = document.getElementById("soundsEnabled");
const soundSettings = document.getElementById("soundSettings");
const soundDone = document.getElementById("soundDone");
const soundRetry = document.getElementById("soundRetry");
const soundAttention = document.getElementById("soundAttention");
const soundError = document.getElementById("soundError");
const soundVolume = document.getElementById("soundVolume");
const soundTests = [...document.querySelectorAll(".sound-test")];

const SOUND_CONTROLS = {
  monitorSoundDone: soundDone,
  monitorSoundRetry: soundRetry,
  monitorSoundAttention: soundAttention,
  monitorSoundError: soundError
};

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
    retry: "retry",
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

function refreshSoundUi() {
  soundSettings.classList.toggle("muted", !soundsEnabled.checked);
}

async function testSound(select) {
  const sound = select?.value || "off";
  if (sound === "off") return;
  await chrome.runtime.sendMessage({
    type: "monitor-test-sound",
    sound,
    volume: Number(soundVolume.value)
  }).catch(() => {});
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  enabled.checked = settings.monitorEnabled !== false;
  showIdle.checked = settings.monitorShowIdle === true;
  compact.checked = settings.monitorCompact === true;
  animations.checked = settings.monitorAnimations !== false;
  soundsEnabled.checked = settings.monitorSoundsEnabled !== false;
  soundDone.value = settings.monitorSoundDone || DEFAULTS.monitorSoundDone;
  soundRetry.value = settings.monitorSoundRetry || DEFAULTS.monitorSoundRetry;
  soundAttention.value = settings.monitorSoundAttention || DEFAULTS.monitorSoundAttention;
  soundError.value = settings.monitorSoundError || DEFAULTS.monitorSoundError;
  soundVolume.value = settings.monitorSoundVolume ?? DEFAULTS.monitorSoundVolume;
  refreshSoundUi();
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

soundsEnabled.addEventListener("change", () => {
  chrome.storage.local.set({ monitorSoundsEnabled: soundsEnabled.checked });
  refreshSoundUi();
});

for (const [storageKey, select] of Object.entries(SOUND_CONTROLS)) {
  select.addEventListener("change", () => {
    chrome.storage.local.set({ [storageKey]: select.value });
  });
}

soundVolume.addEventListener("input", () => {
  chrome.storage.local.set({ monitorSoundVolume: Number(soundVolume.value) });
});

for (const button of soundTests) {
  button.addEventListener("click", () => {
    const select = document.getElementById(button.dataset.soundKey);
    testSound(select);
  });
}

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
