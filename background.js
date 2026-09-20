const chats = new Map();

const PREFS_KEY = "monitorChatPrefs";
const ORDER_KEY = "monitorChatOrder";
const PROJECT_ORDER_KEY = "monitorProjectOrder";
const SECTIONS_KEY = "monitorSections";
const SECTION_META_KEY = "monitorSectionMeta";
const SECTION_UI_KEY = "monitorSectionUi";
const GROUP_MODE_KEY = "monitorGroupMode";
const HISTORY_KEY = "monitorHistory";
const ACTIVE_RUNS_KEY = "monitorActiveRuns";
const HISTORY_LIMIT = 100;
const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_RUN_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_STATE_KEY = "monitorUpdateState";
const WHATS_NEW_KEY = "monitorWhatsNewState";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAYOUT_UNDO_TTL_MS = 10000;
const GROUP_MODE_DEFAULT = "project";
const VALID_GROUP_MODES = new Set(["project", "manual", "none"]);
const RELEASES_API_URL =
  "https://api.github.com/repos/JoelMomo/chatgpt-multichat-monitor/releases/latest";
const RELEASES_PAGE_URL =
  "https://github.com/JoelMomo/chatgpt-multichat-monitor/releases";

const SOUND_DEFAULTS = {
  monitorSoundsEnabled: true,
  monitorSoundDone: "pop",
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
let chatOrder = [];
let projectOrder = [];
let sections = [];
let sectionMeta = {};
let sectionUi = {};
let groupMode = GROUP_MODE_DEFAULT;
let history = [];
let activeRuns = {};
const activeRunLastPersistedAt = new Map();
let activeRunsWritePromise = Promise.resolve();
let updateState = {
  lastAttemptAt: 0,
  checkedAt: 0,
  latestVersion: "",
  latestUrl: RELEASES_PAGE_URL,
  dismissedVersion: ""
};
let whatsNewState = null;
let initPromise = null;
let updateCheckPromise = null;
let lastAudioRequestAt = 0;
const pendingDoneSoundTimers = new Map();
const layoutUndos = new Map();

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

function activeRunFor(chatKey) {
  const run = activeRuns[chatKey];
  if (!run || typeof run !== "object") return null;
  const startedAt = Number(run.startedAt);
  const updatedAt = Number(run.updatedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0 ||
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt > ACTIVE_RUN_MAX_AGE_MS) {
    if (activeRuns[chatKey]) {
      delete activeRuns[chatKey];
      queueActiveRunsPersist();
    }
    return null;
  }
  return {
    startedAt,
    workPhase: String(run.workPhase || ""),
    phaseStartedAt: Number.isFinite(Number(run.phaseStartedAt))
      ? Number(run.phaseStartedAt)
      : null,
    updatedAt
  };
}

function queueActiveRunsPersist() {
  const snapshot = JSON.parse(JSON.stringify(activeRuns));
  activeRunsWritePromise = activeRunsWritePromise
    .catch(() => {})
    .then(() => chrome.storage.local.set({ [ACTIVE_RUNS_KEY]: snapshot }));
  return activeRunsWritePromise;
}

function clearActiveRun(chatKey) {
  if (!chatKey || !activeRuns[chatKey]) return false;
  delete activeRuns[chatKey];
  activeRunLastPersistedAt.delete(chatKey);
  return true;
}

async function ensureInitialized() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await chrome.storage.local.get({
      [PREFS_KEY]: {},
      [ORDER_KEY]: [],
      [PROJECT_ORDER_KEY]: [],
      [SECTIONS_KEY]: [],
      [SECTION_META_KEY]: {},
      [SECTION_UI_KEY]: {},
      [GROUP_MODE_KEY]: GROUP_MODE_DEFAULT,
      [HISTORY_KEY]: [],
      [ACTIVE_RUNS_KEY]: {},
      [UPDATE_STATE_KEY]: null,
      [WHATS_NEW_KEY]: null
    });
    chatPrefs = stored[PREFS_KEY] && typeof stored[PREFS_KEY] === "object"
      ? stored[PREFS_KEY]
      : {};
    chatOrder = Array.isArray(stored[ORDER_KEY])
      ? [...new Set(stored[ORDER_KEY].filter((key) => typeof key === "string" && key))].slice(0, 200)
      : [];
    projectOrder = Array.isArray(stored[PROJECT_ORDER_KEY])
      ? [...new Set(stored[PROJECT_ORDER_KEY].filter((key) => typeof key === "string" && key.startsWith("project:")))].slice(0, 100)
      : [];
    sections = Array.isArray(stored[SECTIONS_KEY])
      ? [...new Set(stored[SECTIONS_KEY].filter((id) => typeof id === "string" && id))].slice(0, 40)
      : [];
    sectionMeta = stored[SECTION_META_KEY] && typeof stored[SECTION_META_KEY] === "object"
      ? stored[SECTION_META_KEY]
      : {};
    sectionUi = stored[SECTION_UI_KEY] && typeof stored[SECTION_UI_KEY] === "object"
      ? stored[SECTION_UI_KEY]
      : {};
    groupMode = VALID_GROUP_MODES.has(stored[GROUP_MODE_KEY])
      ? stored[GROUP_MODE_KEY]
      : GROUP_MODE_DEFAULT;
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    history = Array.isArray(stored[HISTORY_KEY])
      ? stored[HISTORY_KEY].filter((item) => Number(item.ts) >= cutoff).slice(0, HISTORY_LIMIT)
      : [];

    const activeRunCutoff = Date.now() - ACTIVE_RUN_MAX_AGE_MS;
    activeRuns = {};
    if (stored[ACTIVE_RUNS_KEY] && typeof stored[ACTIVE_RUNS_KEY] === "object") {
      for (const [key, value] of Object.entries(stored[ACTIVE_RUNS_KEY])) {
        if (!key || !value || typeof value !== "object") continue;
        const startedAt = Number(value.startedAt);
        const updatedAt = Number(value.updatedAt);
        if (!Number.isFinite(startedAt) || startedAt <= 0 ||
            !Number.isFinite(updatedAt) || updatedAt < activeRunCutoff) {
          continue;
        }
        activeRuns[key] = {
          startedAt,
          workPhase: typeof value.workPhase === "string"
            ? value.workPhase.trim().replace(/\s+/g, " ").slice(0, 48)
            : "",
          phaseStartedAt: Number.isFinite(Number(value.phaseStartedAt))
            ? Number(value.phaseStartedAt)
            : null,
          updatedAt
        };
        activeRunLastPersistedAt.set(key, updatedAt);
      }
    }

    const storedUpdate = stored[UPDATE_STATE_KEY];
    if (storedUpdate && typeof storedUpdate === "object") {
      updateState = {
        ...updateState,
        lastAttemptAt: Number(storedUpdate.lastAttemptAt) || 0,
        checkedAt: Number(storedUpdate.checkedAt) || 0,
        latestVersion: typeof storedUpdate.latestVersion === "string"
          ? storedUpdate.latestVersion
          : "",
        latestUrl: typeof storedUpdate.latestUrl === "string" && storedUpdate.latestUrl
          ? storedUpdate.latestUrl
          : RELEASES_PAGE_URL,
        dismissedVersion: typeof storedUpdate.dismissedVersion === "string"
          ? storedUpdate.dismissedVersion
          : ""
      };
    }

    const storedWhatsNew = stored[WHATS_NEW_KEY];
    whatsNewState = storedWhatsNew && typeof storedWhatsNew === "object"
      ? {
          version: String(storedWhatsNew.version || ""),
          previousVersion: String(storedWhatsNew.previousVersion || ""),
          pending: storedWhatsNew.pending === true
        }
      : null;
  })();
  return initPromise;
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split(".").map((part) => Number(part) || 0);
  const b = normalizeVersion(right).split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length, 3);

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
}

function updateAvailable() {
  const currentVersion = chrome.runtime.getManifest().version;
  return Boolean(
    updateState.latestVersion &&
    compareVersions(updateState.latestVersion, currentVersion) > 0 &&
    updateState.dismissedVersion !== updateState.latestVersion
  );
}

function releaseUrlForVersion(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return RELEASES_PAGE_URL;

  const latestKnown = normalizeVersion(updateState.latestVersion);
  if (latestKnown && compareVersions(normalized, latestKnown) <= 0) {
    return RELEASES_PAGE_URL + "/tag/v" + encodeURIComponent(normalized);
  }

  return RELEASES_PAGE_URL;
}

function publicUpdateInfo() {
  const currentVersion = chrome.runtime.getManifest().version;
  return {
    currentVersion,
    updateAvailable: updateAvailable(),
    latestVersion: updateState.latestVersion,
    latestUrl: updateState.latestUrl || RELEASES_PAGE_URL,
    checkedAt: updateState.checkedAt || 0,
    whatsNew: whatsNewState?.pending
      ? {
          version: whatsNewState.version,
          previousVersion: whatsNewState.previousVersion,
          url: releaseUrlForVersion(whatsNewState.version)
        }
      : null
  };
}

async function persistUpdateState() {
  await chrome.storage.local.set({
    [UPDATE_STATE_KEY]: updateState
  });
}

async function checkForUpdates() {
  await ensureInitialized();

  const now = Date.now();

  if (updateState.lastAttemptAt &&
      now - updateState.lastAttemptAt < UPDATE_CHECK_INTERVAL_MS) {
    return updateState;
  }

  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = (async () => {
    const next = {
      ...updateState,
      lastAttemptAt: now
    };

    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: {
          Accept: "application/vnd.github+json"
        },
        cache: "no-store"
      });

      let stable = null;

      if (response.status === 404) {
        // GitHub returns 404 when the repository has no stable release yet.
      } else {
        if (!response.ok) {
          throw new Error("GitHub release request failed: " + response.status);
        }

        const release = await response.json();
        if (release &&
            release.draft !== true &&
            release.prerelease !== true &&
            typeof release.tag_name === "string") {
          stable = release;
        }
      }

      next.checkedAt = now;
      next.latestVersion = stable ? normalizeVersion(stable.tag_name) : "";
      next.latestUrl = stable?.html_url || RELEASES_PAGE_URL;

      if (next.dismissedVersion &&
          next.latestVersion &&
          compareVersions(next.dismissedVersion, next.latestVersion) < 0) {
        next.dismissedVersion = "";
      }
    } catch {
      // Keep the last known release and throttle another network attempt for 24h.
    }

    updateState = next;
    await persistUpdateState();
    await updateBadge().catch(() => {});
    return updateState;
  })();

  try {
    return await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
}

async function dismissUpdate(version) {
  await ensureInitialized();
  const normalized = normalizeVersion(version);
  if (!normalized || normalized !== updateState.latestVersion) return false;

  updateState = {
    ...updateState,
    dismissedVersion: normalized
  };
  await persistUpdateState();
  await updateBadge().catch(() => {});
  return true;
}

async function dismissWhatsNew(version) {
  await ensureInitialized();
  const normalized = normalizeVersion(version);
  if (!whatsNewState ||
      normalizeVersion(whatsNewState.version) !== normalized) {
    return false;
  }

  whatsNewState = {
    ...whatsNewState,
    pending: false
  };
  await chrome.storage.local.set({
    [WHATS_NEW_KEY]: whatsNewState
  });
  return true;
}

function prefsFor(key) {
  const prefs = chatPrefs[key];
  return prefs && typeof prefs === "object" ? prefs : {};
}

function decorate(chat) {
  const prefs = prefsFor(chat.chatKey);
  const pending = prefs.pending === true;
  const section = typeof prefs.section === "string" && sections.includes(prefs.section)
    ? prefs.section
    : "";
  return {
    ...chat,
    state: pending && chat.state === "idle" ? "pending" : chat.state,
    alias: typeof prefs.alias === "string" ? prefs.alias : "",
    pinned: prefs.pinned === true,
    hidden: prefs.hidden === true,
    pending,
    section,
    displayTitle: (typeof prefs.alias === "string" && prefs.alias.trim())
      ? prefs.alias.trim()
      : chat.title
  };
}

function rank(state) {
  return ({
    error: 0,
    retry: 1,
    attention: 2,
    finished: 3,
    pending: 4,
    working: 5,
    interrupted: 6,
    draft: 7,
    idle: 8
  })[state] ?? 9;
}

function projectGroupKey(chat) {
  if (chat.projectKey) return "project:" + chat.projectKey;
  return chat.projectKnown === true ? "project:none" : "project:unknown";
}

function projectGroupLabel(chat) {
  if (chat.projectName) return String(chat.projectName).trim();
  return chat.projectKnown === true ? "No project" : "Other chats";
}

function snapshot() {
  const manualIndex = new Map(chatOrder.map((key, index) => [key, index]));
  const projectIndex = new Map(projectOrder.map((key, index) => [key, index]));
  const sectionIndex = new Map([["", 0], ...sections.map((id, index) => [id, index + 1])]);
  const segmented = groupMode === "manual" && sections.length > 0;
  const projectGrouped = groupMode === "project";

  return [...chats.values()]
    .map(decorate)
    .sort((a, b) => {
      if (projectGrouped) {
        const aKey = projectGroupKey(a);
        const bKey = projectGroupKey(b);
        const aProjectOrder = projectIndex.has(aKey) ? projectIndex.get(aKey) : null;
        const bProjectOrder = projectIndex.has(bKey) ? projectIndex.get(bKey) : null;

        if (aProjectOrder !== null && bProjectOrder !== null && aProjectOrder !== bProjectOrder) {
          return aProjectOrder - bProjectOrder;
        }
        if (aProjectOrder !== null && bProjectOrder === null) return -1;
        if (aProjectOrder === null && bProjectOrder !== null) return 1;

        const aNone = a.projectKey ? 0 : 1;
        const bNone = b.projectKey ? 0 : 1;
        if (aNone !== bNone) return aNone - bNone;
        const projectLabelOrder = projectGroupLabel(a).localeCompare(projectGroupLabel(b), undefined, {
          sensitivity: "base",
          numeric: true
        });
        if (projectLabelOrder) return projectLabelOrder;
        const keyOrder = aKey.localeCompare(bKey);
        if (keyOrder) return keyOrder;
      } else if (segmented) {
        const sectionOrder = (sectionIndex.get(a.section) ?? 0) - (sectionIndex.get(b.section) ?? 0);
        if (sectionOrder) return sectionOrder;
      }

      const pinOrder = Number(b.pinned) - Number(a.pinned);
      if (pinOrder) return pinOrder;

      const aManual = manualIndex.has(a.chatKey) ? manualIndex.get(a.chatKey) : null;
      const bManual = manualIndex.has(b.chatKey) ? manualIndex.get(b.chatKey) : null;
      if (!projectGrouped && !segmented) {
        if (aManual !== null && bManual !== null && aManual !== bManual) return aManual - bManual;
        if (aManual !== null && bManual === null) return -1;
        if (aManual === null && bManual !== null) return 1;
      }

      const stateOrder = rank(a.state) - rank(b.state);
      if (stateOrder) return stateOrder;

      if (!projectGrouped && segmented) {
        if (aManual !== null && bManual !== null && aManual !== bManual) return aManual - bManual;
        if (aManual !== null && bManual === null) return -1;
        if (aManual === null && bManual !== null) return 1;
      }

      if (a.state === "working" && b.state === "working") {
        return (a.startedAt || Infinity) - (b.startedAt || Infinity);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

function separatorSnapshot() {
  return sections.map((id) => ({
    id,
    name: typeof sectionMeta[id]?.name === "string" ? sectionMeta[id].name : "",
    collapsed: sectionUi["manual:" + id]?.collapsed === true,
    kind: "manual"
  }));
}

async function persistHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  history = history
    .filter((item) => Number(item.ts) >= cutoff)
    .slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

function recordHistory(chat, previousState) {
  if (!chat ||
      chat.state === previousState ||
      chat.state === "idle" ||
      chat.state === "draft") return;
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

function cancelPendingDoneSound(tabId) {
  const timer = pendingDoneSoundTimers.get(tabId);
  if (!timer) return;
  clearTimeout(timer);
  pendingDoneSoundTimers.delete(tabId);
}

async function maybePlayStateSound(chat) {
  if (!chat || prefsFor(chat.chatKey).hidden) return;
  const key = SOUND_KEY_BY_STATE[chat.state];
  if (!key) return;

  const settings = await getSoundSettings();
  if (!settings.monitorSoundsEnabled) return;
  await playSound(settings[key], settings.monitorSoundVolume);
}

function queueStateSound(chat) {
  if (!chat || !Number.isInteger(chat.tabId)) return;

  cancelPendingDoneSound(chat.tabId);

  if (chat.state !== "finished") {
    maybePlayStateSound(chat).catch(() => {});
    return;
  }

  const timer = setTimeout(() => {
    pendingDoneSoundTimers.delete(chat.tabId);
    const current = chats.get(chat.tabId);
    if (!current || current.state !== "finished") return;
    maybePlayStateSound(current).catch(() => {});
  }, 1200);

  pendingDoneSoundTimers.set(chat.tabId, timer);
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
    chat.state === "retry" || chat.state === "attention" || chat.state === "error" || chat.state === "pending"
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

  if (updateAvailable()) {
    await chrome.action.setBadgeText({ text: "↑" });
    await chrome.action.setBadgeBackgroundColor({ color: "#4777c7" });
    await chrome.action.setTitle({
      title: "ChatGPT MultiChat Monitor - update available: v" +
        updateState.latestVersion
    });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "ChatGPT MultiChat Monitor" });
}

function upsertState(payload, tab) {
  if (!tab || !Number.isInteger(tab.id)) return false;
  const now = Date.now();
  const hadPrevious = chats.has(tab.id);
  const previous = chats.get(tab.id) || {};
  const state = payload.state || "idle";
  const chatKey = chatKeyFromUrl(payload.url || tab.url, tab.id);
  const sameChat = previous.chatKey === chatKey;
  const persistedRun = activeRunFor(chatKey);
  let activeRunsChanged = false;

  const payloadStartedAt = Number(payload.startedAt);
  const payloadPhaseStartedAt = Number(payload.phaseStartedAt);
  const hasWorkPhase = Object.prototype.hasOwnProperty.call(payload, "workPhase");
  const incomingWorkPhase = hasWorkPhase
    ? String(payload.workPhase || "").trim().replace(/\s+/g, " ").slice(0, 48)
    : null;

  let startedAt = Number.isFinite(payloadStartedAt) && payloadStartedAt > 0
    ? payloadStartedAt
    : (sameChat ? previous.startedAt ?? null : null);
  let finishedAt = payload.finishedAt ?? (sameChat ? previous.finishedAt ?? null : null);
  let workPhase = hasWorkPhase
    ? incomingWorkPhase
    : (state === "working" && sameChat ? String(previous.workPhase || "") : "");
  let phaseStartedAt = Number.isFinite(payloadPhaseStartedAt) && payloadPhaseStartedAt > 0
    ? payloadPhaseStartedAt
    : (state === "working" && sameChat ? previous.phaseStartedAt ?? null : null);

  if (state === "working") {
    finishedAt = null;

    if (persistedRun) {
      startedAt = persistedRun.startedAt;

      if (hasWorkPhase) {
        workPhase = incomingWorkPhase;
        if (!workPhase) {
          phaseStartedAt = null;
        } else if (workPhase === persistedRun.workPhase && persistedRun.phaseStartedAt) {
          phaseStartedAt = persistedRun.phaseStartedAt;
        } else if (!(Number.isFinite(payloadPhaseStartedAt) && payloadPhaseStartedAt > 0)) {
          phaseStartedAt = now;
        }
      } else {
        workPhase = persistedRun.workPhase;
        phaseStartedAt = persistedRun.phaseStartedAt;
      }
    } else {
      if (!startedAt) startedAt = now;
      if (workPhase && !phaseStartedAt) phaseStartedAt = startedAt;
    }

    const nextRun = {
      startedAt,
      workPhase,
      phaseStartedAt,
      updatedAt: now
    };
    const currentRun = activeRuns[chatKey];
    const runFieldsChanged = !currentRun ||
      currentRun.startedAt !== nextRun.startedAt ||
      currentRun.workPhase !== nextRun.workPhase ||
      currentRun.phaseStartedAt !== nextRun.phaseStartedAt;
    const persistenceDue = now - (activeRunLastPersistedAt.get(chatKey) || 0) >= ACTIVE_RUN_PERSIST_INTERVAL_MS;

    activeRuns[chatKey] = nextRun;
    if (runFieldsChanged || persistenceDue) {
      activeRunLastPersistedAt.set(chatKey, now);
      activeRunsChanged = true;
    }
  } else {
    if (clearActiveRun(chatKey)) activeRunsChanged = true;
    workPhase = "";
    phaseStartedAt = null;

    if (["finished", "interrupted", "retry", "attention", "error"].includes(state) && !finishedAt) {
      finishedAt = now;
    }
    if (state === "idle" || state === "draft") {
      startedAt = null;
      finishedAt = null;
    }
  }

  const projectKnown = payload.projectKnown === true;
  const incomingProjectKey = typeof payload.projectKey === "string" ? payload.projectKey.trim().slice(0, 180) : "";
  const incomingProjectName = typeof payload.projectName === "string" ? payload.projectName.trim().slice(0, 80) : "";
  const projectKey = projectKnown
    ? incomingProjectKey
    : (sameChat ? String(previous.projectKey || "") : "");
  const projectName = projectKey
    ? (incomingProjectName || (sameChat && previous.projectKey === projectKey ? String(previous.projectName || "") : ""))
    : "";

  const next = {
    tabId: tab.id,
    windowId: tab.windowId,
    chatKey,
    title: cleanTitle(payload.title || tab.title),
    url: payload.url || tab.url || "",
    state,
    startedAt,
    finishedAt,
    workPhase,
    phaseStartedAt,
    updatedAt: payload.updatedAt || now,
    projectKnown: projectKnown || (sameChat && previous.projectKnown === true),
    projectKey,
    projectName
  };

  chats.set(tab.id, next);
  if (hadPrevious) {
    recordHistory(next, previous.state);
    if (previous.state !== next.state) {
      queueStateSound(next);
    }
  }

  if (activeRunsChanged) queueActiveRunsPersist();
  return activeRunsChanged;
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
        chats: data,
        separators: separatorSnapshot()
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
    if (!openIds.has(tabId)) {
      cancelPendingDoneSound(tabId);
      chats.delete(tabId);
    }
  }

  await Promise.allSettled(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;

    if (tab.discarded) {
      const chatKey = chatKeyFromUrl(tab.url, tab.id);
      const run = activeRunFor(chatKey);
      if (run) {
        upsertState({
          state: "working",
          title: tab.title,
          url: tab.url,
          startedAt: run.startedAt,
          workPhase: run.workPhase,
          phaseStartedAt: run.phaseStartedAt
        }, tab);
      } else {
        upsertState({ state: "idle", title: tab.title, url: tab.url }, tab);
      }
      return;
    }

    try {
      const local = await chrome.tabs.sendMessage(tab.id, { type: "monitor-get-local-state" });
      if (local && local.initializing !== true) upsertState(local, tab);
    } catch {
      if (!chats.has(tab.id)) {
        const chatKey = chatKeyFromUrl(tab.url, tab.id);
        const run = activeRunFor(chatKey);
        if (run) {
          upsertState({
            state: "working",
            title: tab.title,
            url: tab.url,
            startedAt: run.startedAt,
            workPhase: run.workPhase,
            phaseStartedAt: run.phaseStartedAt
          }, tab);
        } else {
          upsertState({ state: "idle", title: tab.title, url: tab.url }, tab);
        }
      }
    }
  }));
}

async function acknowledgeFinishedTab(tabId) {
  await ensureInitialized();
  const chat = chats.get(tabId);
  if (!chat || chat.state !== "finished") return false;

  cancelPendingDoneSound(tabId);
  chats.set(tabId, {
    ...chat,
    state: "idle",
    startedAt: null,
    finishedAt: null,
    updatedAt: Date.now()
  });

  try {
    await chrome.tabs.sendMessage(tabId, { type: "monitor-acknowledge-done" });
  } catch {}

  await broadcast();
  return true;
}

async function activateTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    await acknowledgeFinishedTab(tabId);
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
  if (Object.prototype.hasOwnProperty.call(patch, "pending")) {
    if (patch.pending === true) next.pending = true;
    else delete next.pending;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "section")) {
    const section = typeof patch.section === "string" ? patch.section : "";
    if (section && sections.includes(section)) next.section = section;
    else delete next.section;
  }

  if (!next.alias && !next.pinned && !next.hidden && !next.pending && !next.section) delete chatPrefs[chatKey];
  else chatPrefs[chatKey] = next;

  await chrome.storage.local.set({ [PREFS_KEY]: chatPrefs });
  return true;
}

async function clearChatPreferenceField(field) {
  await ensureInitialized();
  if (!["alias", "pinned", "hidden", "pending"].includes(field)) return false;

  for (const key of Object.keys(chatPrefs)) {
    const next = { ...chatPrefs[key] };
    delete next[field];

    if (!next.alias && !next.pinned && !next.hidden && !next.pending && !next.section) delete chatPrefs[key];
    else chatPrefs[key] = next;
  }

  await chrome.storage.local.set({ [PREFS_KEY]: chatPrefs });
  return true;
}

async function setChatOrder(keys) {
  await ensureInitialized();
  const before = captureLayoutState();
  const ordered = [...new Set(
    (Array.isArray(keys) ? keys : [])
      .filter((key) => typeof key === "string" && key)
  )].slice(0, 200);

  const orderedSet = new Set(ordered);
  chatOrder = [
    ...ordered,
    ...chatOrder.filter((key) => !orderedSet.has(key))
  ].slice(0, 200);

  await chrome.storage.local.set({ [ORDER_KEY]: chatOrder });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

async function resetChatOrder() {
  await ensureInitialized();
  chatOrder = [];
  await chrome.storage.local.set({ [ORDER_KEY]: [] });
  return true;
}

async function setProjectOrder(keys) {
  await ensureInitialized();
  const before = captureLayoutState();
  const ordered = [...new Set(
    (Array.isArray(keys) ? keys : [])
      .filter((key) => typeof key === "string" && key.startsWith("project:"))
  )].slice(0, 100);
  const orderedSet = new Set(ordered);

  projectOrder = [
    ...ordered,
    ...projectOrder.filter((key) => !orderedSet.has(key))
  ].slice(0, 100);

  await chrome.storage.local.set({ [PROJECT_ORDER_KEY]: projectOrder });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

function captureLayoutState() {
  const sectionsByChat = {};
  for (const [key, prefs] of Object.entries(chatPrefs)) {
    if (typeof prefs?.section === "string" && prefs.section) {
      sectionsByChat[key] = prefs.section;
    }
  }
  return {
    sections: [...sections],
    chatOrder: [...chatOrder],
    projectOrder: [...projectOrder],
    sectionsByChat,
    sectionMeta: JSON.parse(JSON.stringify(sectionMeta)),
    sectionUi: JSON.parse(JSON.stringify(sectionUi))
  };
}

function registerLayoutUndo(state) {
  const id = globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 10);
  const timer = setTimeout(() => layoutUndos.delete(id), LAYOUT_UNDO_TTL_MS);
  layoutUndos.set(id, { state, timer });
  return id;
}

async function restoreLayoutUndo(id) {
  await ensureInitialized();
  const entry = layoutUndos.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  layoutUndos.delete(id);

  sections = Array.isArray(entry.state.sections)
    ? [...new Set(entry.state.sections.filter((value) => typeof value === "string" && value))].slice(0, 40)
    : [];
  chatOrder = Array.isArray(entry.state.chatOrder)
    ? [...new Set(entry.state.chatOrder.filter((value) => typeof value === "string" && value))].slice(0, 200)
    : [];
  projectOrder = Array.isArray(entry.state.projectOrder)
    ? [...new Set(entry.state.projectOrder.filter((value) => typeof value === "string" && value.startsWith("project:")))].slice(0, 100)
    : [];
  sectionMeta = entry.state.sectionMeta && typeof entry.state.sectionMeta === "object"
    ? entry.state.sectionMeta
    : {};
  sectionUi = entry.state.sectionUi && typeof entry.state.sectionUi === "object"
    ? entry.state.sectionUi
    : {};

  for (const key of Object.keys(chatPrefs)) {
    const next = { ...chatPrefs[key] };
    delete next.section;
    if (!next.alias && !next.pinned && !next.hidden && !next.pending) delete chatPrefs[key];
    else chatPrefs[key] = next;
  }

  const sectionsByChat = entry.state.sectionsByChat && typeof entry.state.sectionsByChat === "object"
    ? entry.state.sectionsByChat
    : {};
  for (const [key, section] of Object.entries(sectionsByChat)) {
    if (!sections.includes(section)) continue;
    chatPrefs[key] = { ...prefsFor(key), section };
  }

  await chrome.storage.local.set({
    [SECTIONS_KEY]: sections,
    [ORDER_KEY]: chatOrder,
    [PROJECT_ORDER_KEY]: projectOrder,
    [PREFS_KEY]: chatPrefs,
    [SECTION_META_KEY]: sectionMeta,
    [SECTION_UI_KEY]: sectionUi
  });
  return true;
}

async function resetLayout() {
  await ensureInitialized();
  const before = captureLayoutState();
  sections = [];
  chatOrder = [];
  projectOrder = [];
  sectionMeta = {};
  sectionUi = {};

  for (const key of Object.keys(chatPrefs)) {
    const next = { ...chatPrefs[key] };
    delete next.section;
    if (!next.alias && !next.pinned && !next.hidden && !next.pending) delete chatPrefs[key];
    else chatPrefs[key] = next;
  }

  await chrome.storage.local.set({
    [SECTIONS_KEY]: [],
    [ORDER_KEY]: [],
    [PROJECT_ORDER_KEY]: [],
    [PREFS_KEY]: chatPrefs,
    [SECTION_META_KEY]: {},
    [SECTION_UI_KEY]: {}
  });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

function createSeparatorId() {
  if (globalThis.crypto?.randomUUID) return "section:" + crypto.randomUUID();
  return "section:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 10);
}

async function addSeparator() {
  await ensureInitialized();
  const before = captureLayoutState();
  const id = createSeparatorId();
  sections = [...sections, id].slice(0, 40);
  sectionMeta[id] = { name: "" };
  await chrome.storage.local.set({
    [SECTIONS_KEY]: sections,
    [SECTION_META_KEY]: sectionMeta
  });
  return { ok: true, id, undoId: registerLayoutUndo(before) };
}

async function removeSeparator(id) {
  await ensureInitialized();
  const index = sections.indexOf(id);
  if (index < 0) return { ok: false };
  const before = captureLayoutState();
  const fallback = index > 0 ? sections[index - 1] : "";
  sections.splice(index, 1);
  delete sectionMeta[id];
  delete sectionUi["manual:" + id];

  for (const key of Object.keys(chatPrefs)) {
    if (chatPrefs[key]?.section !== id) continue;
    const next = { ...chatPrefs[key] };
    if (fallback) next.section = fallback;
    else delete next.section;
    if (!next.alias && !next.pinned && !next.hidden && !next.pending && !next.section) delete chatPrefs[key];
    else chatPrefs[key] = next;
  }

  await chrome.storage.local.set({
    [SECTIONS_KEY]: sections,
    [PREFS_KEY]: chatPrefs,
    [SECTION_META_KEY]: sectionMeta,
    [SECTION_UI_KEY]: sectionUi
  });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

async function setSeparatorMeta(id, patch) {
  await ensureInitialized();
  if (!sections.includes(id) || !patch || typeof patch !== "object") return { ok: false };
  const before = captureLayoutState();
  const current = sectionMeta[id] && typeof sectionMeta[id] === "object" ? sectionMeta[id] : {};
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    const name = String(patch.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (name) next.name = name;
    else delete next.name;
  }

  sectionMeta[id] = next;
  await chrome.storage.local.set({ [SECTION_META_KEY]: sectionMeta });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

async function setSectionCollapsed(sectionKey, collapsed) {
  await ensureInitialized();
  const key = String(sectionKey || "").slice(0, 220);
  if (!key || (!key.startsWith("manual:") && !key.startsWith("project:"))) return { ok: false };
  const before = captureLayoutState();
  const next = { ...(sectionUi[key] || {}) };
  if (collapsed === true) next.collapsed = true;
  else delete next.collapsed;
  if (next.collapsed) sectionUi[key] = next;
  else delete sectionUi[key];
  await chrome.storage.local.set({ [SECTION_UI_KEY]: sectionUi });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

async function moveSeparator(id, direction) {
  await ensureInitialized();
  const index = sections.indexOf(id);
  const nextIndex = index + Number(direction || 0);
  if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return { ok: false };
  const before = captureLayoutState();
  const reordered = [...sections];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  sections = reordered;
  await chrome.storage.local.set({ [SECTIONS_KEY]: sections });
  return { ok: true, undoId: registerLayoutUndo(before) };
}

async function setLayout(tokens) {
  await ensureInitialized();
  const before = captureLayoutState();
  const input = Array.isArray(tokens) ? tokens : [];
  const validSections = new Set(sections);
  const orderedSections = [];
  const orderedChats = [];
  let currentSection = "";

  for (const token of input.slice(0, 260)) {
    if (typeof token !== "string") continue;
    if (token.startsWith("s:")) {
      const id = token.slice(2);
      if (!validSections.has(id) || orderedSections.includes(id)) continue;
      orderedSections.push(id);
      currentSection = id;
      continue;
    }
    if (!token.startsWith("c:")) continue;
    const key = token.slice(2);
    if (!key || orderedChats.includes(key)) continue;
    orderedChats.push(key);
    const next = { ...prefsFor(key) };
    if (currentSection) next.section = currentSection;
    else delete next.section;
    if (!next.alias && !next.pinned && !next.hidden && !next.pending && !next.section) delete chatPrefs[key];
    else chatPrefs[key] = next;
  }

  sections = [
    ...orderedSections,
    ...sections.filter((id) => !orderedSections.includes(id))
  ].slice(0, 40);
  const orderedSet = new Set(orderedChats);
  chatOrder = [
    ...orderedChats,
    ...chatOrder.filter((key) => !orderedSet.has(key))
  ].slice(0, 200);

  await chrome.storage.local.set({
    [SECTIONS_KEY]: sections,
    [PREFS_KEY]: chatPrefs,
    [ORDER_KEY]: chatOrder
  });
  return { ok: true, undoId: registerLayoutUndo(before) };
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
      .then(async () => {
        upsertState(message, sender.tab);

        if (message.state === "finished" &&
            sender.tab?.active &&
            Number.isInteger(sender.tab?.windowId)) {
          try {
            const windowInfo = await chrome.windows.get(sender.tab.windowId);
            if (windowInfo.focused) {
              const acknowledged = await acknowledgeFinishedTab(sender.tab.id);
              if (acknowledged) return;
            }
          } catch {}
        }

        await broadcast();
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-get-active-run") {
    ensureInitialized()
      .then(() => {
        const chatKey = chatKeyFromUrl(message.url || sender.tab?.url || "", sender.tab?.id);
        sendResponse({ ok: true, chatKey, run: activeRunFor(chatKey) });
      })
      .catch(() => sendResponse({ ok: false, run: null }));
    return true;
  }

  if (message?.type === "monitor-get-snapshot") {
    rebuildRegistry()
      .then(() => sendResponse({ chats: snapshot(), separators: separatorSnapshot() }))
      .catch(() => sendResponse({ chats: snapshot(), separators: separatorSnapshot() }));
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
    clearChatPreferenceField("hidden")
      .then((ok) => broadcast().then(() => sendResponse({ ok })))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-clear-chat-pref-field") {
    clearChatPreferenceField(String(message.field || ""))
      .then((ok) => broadcast().then(() => sendResponse({ ok })))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-set-chat-order") {
    setChatOrder(message.chatKeys)
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-set-layout") {
    setLayout(message.tokens)
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-set-project-order") {
    setProjectOrder(message.projectKeys)
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-set-separator-meta") {
    setSeparatorMeta(String(message.id || ""), message.patch || {})
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-set-section-collapsed") {
    setSectionCollapsed(String(message.sectionKey || ""), message.collapsed === true)
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-move-separator") {
    moveSeparator(String(message.id || ""), Number(message.direction || 0))
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-add-separator") {
    addSeparator()
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-remove-separator") {
    removeSeparator(String(message.id || ""))
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-undo-layout") {
    restoreLayoutUndo(String(message.undoId || ""))
      .then((ok) => broadcast().then(() => sendResponse({ ok })))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-reset-layout") {
    resetLayout()
      .then((result) => broadcast().then(() => sendResponse(result)))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-reset-chat-order") {
    resetChatOrder()
      .then((ok) => broadcast().then(() => sendResponse({ ok })))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "monitor-get-history") {
    ensureInitialized()
      .then(() => sendResponse({ history: history.slice(0, 20) }))
      .catch(() => sendResponse({ history: [] }));
    return true;
  }

  if (message?.type === "monitor-get-update-info") {
    checkForUpdates()
      .then(() => sendResponse(publicUpdateInfo()))
      .catch(() => sendResponse(publicUpdateInfo()));
    return true;
  }

  if (message?.type === "monitor-dismiss-update") {
    dismissUpdate(message.version)
      .then((ok) => sendResponse({ ok, ...publicUpdateInfo() }))
      .catch(() => sendResponse({ ok: false, ...publicUpdateInfo() }));
    return true;
  }

  if (message?.type === "monitor-dismiss-whats-new") {
    dismissWhatsNew(message.version)
      .then((ok) => sendResponse({ ok, ...publicUpdateInfo() }))
      .catch(() => sendResponse({ ok: false, ...publicUpdateInfo() }));
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let shouldBroadcast = false;

  if (changes[GROUP_MODE_KEY]) {
    const nextMode = changes[GROUP_MODE_KEY].newValue;
    groupMode = VALID_GROUP_MODES.has(nextMode) ? nextMode : GROUP_MODE_DEFAULT;
    shouldBroadcast = true;
  }
  if (changes[SECTION_UI_KEY]) {
    sectionUi = changes[SECTION_UI_KEY].newValue && typeof changes[SECTION_UI_KEY].newValue === "object"
      ? changes[SECTION_UI_KEY].newValue
      : {};
  }
  if (changes[SECTION_META_KEY]) {
    sectionMeta = changes[SECTION_META_KEY].newValue && typeof changes[SECTION_META_KEY].newValue === "object"
      ? changes[SECTION_META_KEY].newValue
      : {};
    shouldBroadcast = true;
  }

  if (shouldBroadcast) broadcast().catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-monitor") {
    toggleMonitorInActiveTab().catch(() => {});
  } else if (command === "next-working-chat") {
    cycleChat(["working"]).catch(() => {});
  } else if (command === "next-attention-chat") {
    cycleChat(["error", "retry", "attention", "finished", "pending"]).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.windows.get(activeInfo.windowId)
    .then((windowInfo) => {
      if (!windowInfo.focused) return false;
      return acknowledgeFinishedTab(activeInfo.tabId);
    })
    .catch(() => {});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId })
    .then((tabs) => {
      const tab = tabs[0];
      if (tab && Number.isInteger(tab.id)) {
        return acknowledgeFinishedTab(tab.id);
      }
      return false;
    })
    .catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cancelPendingDoneSound(tabId);
  const removed = chats.get(tabId);
  if (!chats.delete(tabId)) return;

  if (removed?.chatKey) {
    const stillOpen = [...chats.values()].some((chat) =>
      chat.chatKey === removed.chatKey && chat.state === "working"
    );
    if (!stillOpen && clearActiveRun(removed.chatKey)) {
      queueActiveRunsPersist().catch(() => {});
    }
  }

  broadcast().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isLoading = changeInfo.status === "loading";
  const discardedNow = changeInfo.discarded === true;

  if (!changeInfo.url && !changeInfo.title && !isLoading && changeInfo.discarded === undefined) {
    return;
  }

  if (changeInfo.url && !changeInfo.url.startsWith("https://chatgpt.com/")) {
    cancelPendingDoneSound(tabId);
    if (chats.delete(tabId)) broadcast().catch(() => {});
    return;
  }

  const previous = chats.get(tabId);
  if (!previous) return;

  if (discardedNow || isLoading) {
    const nextUrl = changeInfo.url || tab.url || previous.url;
    const nextChatKey = chatKeyFromUrl(nextUrl, tabId);

    if (nextChatKey === previous.chatKey) {
      chats.set(tabId, {
        ...previous,
        windowId: tab.windowId,
        title: cleanTitle(changeInfo.title || tab.title || previous.title),
        url: nextUrl
      });
    } else {
      if (clearActiveRun(previous.chatKey)) queueActiveRunsPersist().catch(() => {});
      upsertState({
        state: "idle",
        title: changeInfo.title || tab.title || previous.title,
        url: nextUrl
      }, tab);
    }

    broadcast().catch(() => {});
    return;
  }

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

chrome.runtime.onInstalled.addListener((details) => {
  (async () => {
    await ensureInitialized();

    if (details.reason === "update") {
      const currentVersion = chrome.runtime.getManifest().version;
      const previousVersion = normalizeVersion(details.previousVersion);

      if (previousVersion &&
          compareVersions(currentVersion, previousVersion) !== 0) {
        whatsNewState = {
          version: currentVersion,
          previousVersion,
          pending: true
        };
        await chrome.storage.local.set({
          [WHATS_NEW_KEY]: whatsNewState
        });
      }
    }

    await chrome.storage.local.remove("monitorDoneVisibilityMs");
    await injectIntoOpenTabs();
    await checkForUpdates();
  })().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    await injectIntoOpenTabs();
    await checkForUpdates();
  })().catch(() => {});
});

ensureInitialized()
  .then(async () => {
    await injectIntoOpenTabs();
    await checkForUpdates();
  })
  .catch(() => {});
