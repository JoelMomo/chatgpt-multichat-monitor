const chats = new Map();

const PREFS_KEY = "monitorChatPrefs";
const HISTORY_KEY = "monitorHistory";
const HISTORY_LIMIT = 100;
const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SOUND_DEFAULTS = {
  monitorSoundsEnabled: true,
  monitorSoundDone: "off",
  monitorSoundRetry: "potion",
  monitorSoundAttention: "point",
  monitorSoundError: "chan",
  monitorSoundVolume: 0.8
};

const VALID_SOUNDS = new Set([
  "off",
  "pop",
  "cash-register",
  "chan",
  "potion",
  "point",
  "page-turn"
]);

const SOUND_KEY_BY_STATE = {
  finished: "monitorSoundDone",
  retry: "monitorSoundRetry",
  attention: "monitorSoundAttention",
  error: "monitorSoundError"
};

let chatPrefs = {};
let history = [];
let initPromise = null;
let lastAudioRequestAt = 0;

function cleanTitle(title) {
  const value = String(title || "")
    .replace(/\s+-\s+ChatGPT\s*$/i, "")
    .trim();
  return value && value.toLowerCase() !== "chatgpt" ? value : "ChatGPT";
}

function chatKeyFromUrl(url, tabId) {
  try {
    const parsed = new URL(url || "");
    const conversation = parsed.pathname.match(/\/c\/([^/?#]+)/);
    if (conversation) return "conversation:" + conversation[1];
  } catch {}
  return "tab:" + String(tabId ?? "unknown");
}

async function ensureInitialized() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await chrome.storage.local.get({
      [PREFS_KEY]: {},
      [HISTORY_KEY]: []
    });
    chatPrefs = stored[PREFS_KEY] && typeof stored[PREFS_KEY] === "object"
      ? stored[PREFS_KEY]
      : {};
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    history = Array.isArray(stored[HISTORY_KEY])
      ? stored[HISTORY_KEY].filter((item) => Number(item.ts) >= cutoff).slice(0, HISTORY_LIMIT)
      : [];
  })();
  return initPromise;
}

function prefsFor(key) {
  const prefs = chatPrefs[key];
  return prefs && typeof prefs === "object" ? prefs : {};
}

function decorate(chat) {
  const prefs = prefsFor(chat.chatKey);
  return {
    ...chat,
    alias: typeof prefs.alias === "string" ? prefs.alias : "",
    pinned: prefs.pinned === true,
    hidden: prefs.hidden === true,
    displayTitle: (typeof prefs.alias === "string" && prefs.alias.trim())
      ? prefs.alias.trim()
      : chat.title
  };
}

function rank(state) {
  return ({
    retry: 0,
    attention: 1,
    error: 2,
    finished: 3,
    working: 4,
    interrupted: 5,
    idle: 6
  })[state] ?? 9;
}

function snapshot() {
  return [...chats.values()]
    .map(decorate)
    .sort((a, b) => {
      const pinOrder = Number(b.pinned) - Number(a.pinned);
      if (pinOrder) return pinOrder;
      const stateOrder = rank(a.state) - rank(b.state);
      if (stateOrder) return stateOrder;
      if (a.state === "working" && b.state === "working") {
        return (a.startedAt || Infinity) - (b.startedAt || Infinity);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

async function persistHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  history = history
    .filter((item) => Number(item.ts) >= cutoff)
    .slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

function recordHistory(chat, previousState) {
  if (!chat || chat.state === previousState || chat.state === "idle") return;
  history.unshift({
    ts: Date.now(),
    chatKey: chat.chatKey,
    title: decorate(chat).displayTitle,
    state: chat.state
  });
  persistHistory().catch(() => {});
}

async function getSoundSettings() {
  const stored = await chrome.storage.local.get(SOUND_DEFAULTS);
  const volumeValue = Number(stored.monitorSoundVolume);
  const settings = {
    monitorSoundsEnabled: stored.monitorSoundsEnabled !== false,
    monitorSoundVolume: Number.isFinite(volumeValue)
      ? Math.max(0, Math.min(1, volumeValue))
      : SOUND_DEFAULTS.monitorSoundVolume
  };

  for (const key of Object.values(SOUND_KEY_BY_STATE)) {
    settings[key] = VALID_SOUNDS.has(stored[key])
      ? stored[key]
      : SOUND_DEFAULTS[key];
  }

  return settings;
}

async function ensureOffscreen() {
  let exists = false;

  if (chrome.offscreen.hasDocument) {
    exists = await chrome.offscreen.hasDocument();
  } else {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    exists = contexts.length > 0;
  }

  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a local sound when a monitored ChatGPT state changes."
    });
  }
}

async function playSound(sound, volume) {
  if (!VALID_SOUNDS.has(sound) || sound === "off") return false;
  lastAudioRequestAt = Date.now();
  await ensureOffscreen();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "play",
    sound,
    volume
  });
  return true;
}

async function maybePlayStateSound(chat) {
  if (!chat || prefsFor(chat.chatKey).hidden) return;
  const key = SOUND_KEY_BY_STATE[chat.state];
  if (!key) return;

  const settings = await getSoundSettings();
  if (!settings.monitorSoundsEnabled) return;
  await playSound(settings[key], settings.monitorSoundVolume);
}

async function closeOffscreenIfIdle() {
  if (Date.now() - lastAudioRequestAt < 7000) return;

  try {
    const exists = chrome.offscreen.hasDocument
      ? await chrome.offscreen.hasDocument()
      : (await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"]
        })).length > 0;

    if (exists) await chrome.offscreen.closeDocument();
  } catch {}
}

async function updateBadge() {
  const data = snapshot().filter((chat) => !chat.hidden);
  const attentionCount = data.filter((chat) =>
    chat.state === "retry" || chat.state === "attention" || chat.state === "error"
  ).length;
  const workingCount = data.filter((chat) => chat.state === "working").length;

  if (attentionCount > 0) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b56b2d" });
    await chrome.action.setTitle({
      title: "ChatGPT MultiChat Monitor - " + attentionCount +
        " chat" + (attentionCount === 1 ? "" : "s") + " need attention"
    });
    return;
  }

  if (workingCount > 0) {
    await chrome.action.setBadgeText({ text: String(Math.min(workingCount, 99)) });
    await chrome.action.setBadgeBackgroundColor({ color: "#287f77" });
    await chrome.action.setTitle({
      title: "ChatGPT MultiChat Monitor - " + workingCount + " working"
    });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "ChatGPT MultiChat Monitor" });
}

function upsertState(payload, tab) {
  if (!tab || !Number.isInteger(tab.id)) return;
  const now = Date.now();
  const hadPrevious = chats.has(tab.id);
  const previous = chats.get(tab.id) || {};
  const state = payload.state || "idle";
  const chatKey = chatKeyFromUrl(payload.url || tab.url, tab.id);

  let startedAt = payload.startedAt ?? previous.startedAt ?? null;
  let finishedAt = payload.finishedAt ?? previous.finishedAt ?? null;

  if (state === "working" && previous.state !== "working" && !payload.startedAt) {
    startedAt = now;
    finishedAt = null;
  }
  if (["finished", "interrupted", "retry", "attention", "error"].includes(state) && !finishedAt) {
    finishedAt = now;
  }
  if (state === "idle") {
    startedAt = null;
    finishedAt = null;
  }

  const next = {
    tabId: tab.id,
    windowId: tab.windowId,
    chatKey,
    title: cleanTitle(payload.title || tab.title),
    url: payload.url || tab.url || "",
    state,
    startedAt,
    finishedAt,
    updatedAt: payload.updatedAt || now
  };

  chats.set(tab.id, next);
  if (hadPrevious) {
    recordHistory(next, previous.state);
    if (previous.state !== next.state) {
      maybePlayStateSound(next).catch(() => {});
    }
  }
}

async function broadcast() {
  await ensureInitialized();
  const data = snapshot();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  } catch {
    return;
  }

  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => chrome.tabs.sendMessage(tab.id, {
        type: "monitor-snapshot",
        chats: data
      }))
  );
  await updateBadge();
}

async function rebuildRegistry() {
  await ensureInitialized();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  } catch {
    return;
  }

  const openIds = new Set(tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => tab.id));
  for (const tabId of chats.keys()) {
    if (!openIds.has(tabId)) chats.delete(tabId);
  }

  await Promise.allSettled(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    try {
      const local = await chrome.tabs.sendMessage(tab.id, { type: "monitor-get-local-state" });
      if (local) upsertState(local, tab);
    } catch {
      if (!chats.has(tab.id)) {
        upsertState({ state: "idle", title: tab.title, url: tab.url }, tab);
      }
    }
  }));
}

async function activateTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    return true;
  } catch {
    return false;
  }
}

async function setChatPreference(chatKey, patch) {
  await ensureInitialized();
  if (!chatKey || typeof patch !== "object" || patch === null) return false;
  const current = prefsFor(chatKey);
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, "alias")) {
    const alias = String(patch.alias || "").trim().slice(0, 60);
    if (alias) next.alias = alias;
    else delete next.alias;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "pinned")) {
    next.pinned = patch.pinned === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "hidden")) {
    next.hidden = patch.hidden === true;
  }

  if (!next.alias && !next.pinned && !next.hidden) delete chatPrefs[chatKey];
  else chatPrefs[chatKey] = next;

  await chrome.storage.local.set({ [PREFS_KEY]: chatPrefs });
  return true;
}

async function cycleChat(states) {
  await rebuildRegistry();
  const data = snapshot().filter((chat) =>
    !chat.hidden && states.includes(chat.state)
  );
  if (!data.length) return false;

  let active = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    active = tabs[0] || null;
  } catch {}

  const currentIndex = active
    ? data.findIndex((chat) => chat.tabId === active.id)
    : -1;
  const next = data[(currentIndex + 1 + data.length) % data.length];
  return activateTab(next.tabId);
}

async function toggleMonitorInActiveTab() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return false;
  }
  const tab = tabs[0];
  if (!tab || !Number.isInteger(tab.id) || !String(tab.url || "").startsWith("https://chatgpt.com/")) {
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "monitor-toggle-overlay" });
    return true;
  } catch {
    return false;
  }
}

async function injectIntoOpenTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  } catch {
    return;
  }

  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }))
  );

  await rebuildRegistry();
  await broadcast();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "monitor-state") {
    ensureInitialized()
      .then(() => {
        upsertState(message, sender.tab);
        return broadcast();
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-get-snapshot") {
    rebuildRegistry()
      .then(() => sendResponse({ chats: snapshot() }))
      .catch(() => sendResponse({ chats: snapshot() }));
    return true;
  }

  if (message?.type === "monitor-activate-tab") {
    activateTab(Number(message.tabId))
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-set-chat-pref") {
    setChatPreference(String(message.chatKey || ""), message.patch || {})
      .then((ok) => broadcast().then(() => sendResponse({ ok })))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-unhide-all") {
    ensureInitialized()
      .then(async () => {
        for (const key of Object.keys(chatPrefs)) {
          if (chatPrefs[key]?.hidden) {
            chatPrefs[key] = { ...chatPrefs[key], hidden: false };
            if (!chatPrefs[key].alias && !chatPrefs[key].pinned) delete chatPrefs[key];
          }
        }
        await chrome.storage.local.set({ [PREFS_KEY]: chatPrefs });
        await broadcast();
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-get-history") {
    ensureInitialized()
      .then(() => sendResponse({ history: history.slice(0, 20) }))
      .catch(() => sendResponse({ history: [] }));
    return true;
  }

  if (message?.type === "monitor-clear-history") {
    history = [];
    chrome.storage.local.set({ [HISTORY_KEY]: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-test-sound") {
    const sound = VALID_SOUNDS.has(message.sound) ? message.sound : "off";
    const volumeValue = Number(message.volume);
    const volume = Number.isFinite(volumeValue)
      ? Math.max(0, Math.min(1, volumeValue))
      : SOUND_DEFAULTS.monitorSoundVolume;

    playSound(sound, volume)
      .then((played) => sendResponse({ ok: true, played }))
      .catch(() => sendResponse({ ok: false, played: false }));
    return true;
  }

  if (message?.type === "offscreen-audio-idle") {
    closeOffscreenIfIdle().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-monitor") {
    toggleMonitorInActiveTab().catch(() => {});
  } else if (command === "next-working-chat") {
    cycleChat(["working"]).catch(() => {});
  } else if (command === "next-attention-chat") {
    cycleChat(["retry", "attention", "error", "finished"]).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!chats.delete(tabId)) return;
  broadcast().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;
  if (changeInfo.url && !changeInfo.url.startsWith("https://chatgpt.com/")) {
    if (chats.delete(tabId)) broadcast().catch(() => {});
    return;
  }
  const previous = chats.get(tabId);
  if (!previous) return;

  const nextUrl = changeInfo.url || tab.url || previous.url;
  chats.set(tabId, {
    ...previous,
    chatKey: chatKeyFromUrl(nextUrl, tabId),
    title: cleanTitle(changeInfo.title || tab.title || previous.title),
    url: nextUrl,
    updatedAt: Date.now()
  });
  broadcast().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenTabs().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenTabs().catch(() => {});
});

ensureInitialized()
  .then(() => injectIntoOpenTabs())
  .catch(() => {});
