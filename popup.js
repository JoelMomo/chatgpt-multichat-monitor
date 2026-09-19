const DEFAULTS = {
  monitorEnabled: true,
  monitorShowIdle: false,
  monitorCompact: false,
  monitorAnimations: true,
  monitorOpacity: 1,
  monitorTheme: "dark",
  monitorSoundsEnabled: true,
  monitorSoundDone: "pop",
  monitorSoundRetry: "potion",
  monitorSoundAttention: "point",
  monitorSoundError: "chan",
  monitorSoundVolume: 0.8
};

const enabled = document.getElementById("enabled");
const showIdle = document.getElementById("showIdle");
const compact = document.getElementById("compact");
const theme = document.getElementById("theme");
const opacity = document.getElementById("opacity");
const opacityValue = document.getElementById("opacityValue");
const animations = document.getElementById("animations");

const resetPosition = document.getElementById("resetPosition");
const resetSize = document.getElementById("resetSize");
const restoreHidden = document.getElementById("restoreHidden");
const restoreHiddenData = document.getElementById("restoreHiddenData");
const clearAliases = document.getElementById("clearAliases");
const clearPins = document.getElementById("clearPins");
const resetOrder = document.getElementById("resetOrder");
const clearHistory = document.getElementById("clearHistory");
const historyRoot = document.getElementById("history");
const historySummary = document.getElementById("historySummary");

const updateNotice = document.getElementById("updateNotice");
const updateVersion = document.getElementById("updateVersion");
const updateLink = document.getElementById("updateLink");
const dismissUpdate = document.getElementById("dismissUpdate");
const whatsNewNotice = document.getElementById("whatsNewNotice");
const whatsNewVersion = document.getElementById("whatsNewVersion");
const whatsNewLink = document.getElementById("whatsNewLink");
const dismissWhatsNew = document.getElementById("dismissWhatsNew");

const soundsEnabled = document.getElementById("soundsEnabled");
const soundSettings = document.getElementById("soundSettings");
const soundSummary = document.getElementById("soundSummary");
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

function resolvedTheme(value) {
  if (value === "light" || value === "dark") return value;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyPopupTheme(value) {
  document.documentElement.dataset.theme = resolvedTheme(value);
}

function updateOpacityValue(value) {
  const numeric = Number(value);
  opacityValue.textContent = Math.round((Number.isFinite(numeric) ? numeric : 1) * 100) + "%";
}

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
  const values = Array.isArray(items) ? items.slice(0, 12) : [];
  historySummary.textContent = String(values.length);
  historyRoot.replaceChildren();

  if (values.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No recent activity";
    historyRoot.appendChild(empty);
    return;
  }

  for (const item of values) {
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

function renderUpdateInfo(info) {
  const latest = String(info?.latestVersion || "");
  const hasUpdate = info?.updateAvailable === true && latest;

  updateNotice.hidden = !hasUpdate;
  if (hasUpdate) {
    updateVersion.textContent = "v" + latest;
    updateLink.href = info.latestUrl || "https://github.com/JoelMomo/chatgpt-multichat-monitor/releases";
  }

  const whatsNew = info?.whatsNew;
  const hasWhatsNew = Boolean(whatsNew?.version);
  whatsNewNotice.hidden = !hasWhatsNew;

  if (hasWhatsNew) {
    whatsNewVersion.textContent = "v" + whatsNew.version;
    whatsNewLink.href = whatsNew.url ||
      "https://github.com/JoelMomo/chatgpt-multichat-monitor/releases";
  }
}

async function loadUpdateInfo() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "monitor-get-update-info"
    });
    renderUpdateInfo(response || {});
  } catch {
    renderUpdateInfo({});
  }
}

function refreshSoundUi() {
  const active = soundsEnabled.checked;
  soundSettings.classList.toggle("muted", !active);
  soundSummary.textContent = active ? "On" : "Off";
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

function showButtonResult(button, text, fallback) {
  button.textContent = text;
  setTimeout(() => {
    button.textContent = fallback;
  }, 1000);
}

async function clearPreferenceField(field, button, doneText, fallback) {
  const response = await chrome.runtime.sendMessage({
    type: "monitor-clear-chat-pref-field",
    field
  }).catch(() => null);

  showButtonResult(button, response?.ok ? doneText : "Failed", fallback);
}

async function restoreHiddenChats(button) {
  const response = await chrome.runtime.sendMessage({
    type: "monitor-unhide-all"
  }).catch(() => null);

  showButtonResult(button, response?.ok ? "Restored" : "Failed", button === restoreHidden ? "Restore hidden" : "Restore hidden chats");
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);

  enabled.checked = settings.monitorEnabled !== false;
  showIdle.checked = settings.monitorShowIdle === true;
  compact.checked = settings.monitorCompact === true;
  theme.value = settings.monitorTheme || DEFAULTS.monitorTheme;
  opacity.value = settings.monitorOpacity ?? DEFAULTS.monitorOpacity;
  updateOpacityValue(opacity.value);
  applyPopupTheme(theme.value);
  animations.checked = settings.monitorAnimations !== false;

  soundsEnabled.checked = settings.monitorSoundsEnabled !== false;
  soundDone.value = settings.monitorSoundDone || DEFAULTS.monitorSoundDone;
  soundRetry.value = settings.monitorSoundRetry || DEFAULTS.monitorSoundRetry;
  soundAttention.value = settings.monitorSoundAttention || DEFAULTS.monitorSoundAttention;
  soundError.value = settings.monitorSoundError || DEFAULTS.monitorSoundError;
  soundVolume.value = settings.monitorSoundVolume ?? DEFAULTS.monitorSoundVolume;

  refreshSoundUi();
  await Promise.all([
    loadHistory(),
    loadUpdateInfo()
  ]);
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

theme.addEventListener("change", () => {
  chrome.storage.local.set({ monitorTheme: theme.value });
  applyPopupTheme(theme.value);
});

opacity.addEventListener("input", () => {
  const value = Number(opacity.value);
  updateOpacityValue(value);
  chrome.storage.local.set({ monitorOpacity: value });
});

animations.addEventListener("change", () => {
  chrome.storage.local.set({ monitorAnimations: animations.checked });
});

resetPosition.addEventListener("click", async () => {
  await chrome.storage.local.set({ monitorPosition: null });
  showButtonResult(resetPosition, "Reset", "Reset position");
});

resetSize.addEventListener("click", async () => {
  await chrome.storage.local.set({ monitorSize: null });
  showButtonResult(resetSize, "Auto", "Auto size");
});

restoreHidden.addEventListener("click", () => restoreHiddenChats(restoreHidden));
restoreHiddenData.addEventListener("click", () => restoreHiddenChats(restoreHiddenData));

clearAliases.addEventListener("click", () => {
  clearPreferenceField("alias", clearAliases, "Cleared", "Clear aliases");
});

clearPins.addEventListener("click", () => {
  clearPreferenceField("pinned", clearPins, "Cleared", "Clear pins");
});

resetOrder.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "monitor-reset-chat-order"
  }).catch(() => null);
  showButtonResult(resetOrder, response?.ok ? "Reset" : "Failed", "Reset chat order");
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

clearHistory.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "monitor-clear-history" }).catch(() => {});
  renderHistory([]);
  showButtonResult(clearHistory, "Cleared", "Clear history");
});

dismissUpdate.addEventListener("click", async () => {
  const version = updateVersion.textContent.replace(/^v/i, "");
  const response = await chrome.runtime.sendMessage({
    type: "monitor-dismiss-update",
    version
  }).catch(() => null);

  if (response?.ok) renderUpdateInfo(response);
});

dismissWhatsNew.addEventListener("click", async () => {
  const version = whatsNewVersion.textContent.replace(/^v/i, "");
  const response = await chrome.runtime.sendMessage({
    type: "monitor-dismiss-whats-new",
    version
  }).catch(() => null);

  if (response?.ok) renderUpdateInfo(response);
});

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (theme.value === "system") applyPopupTheme("system");
});

load();
