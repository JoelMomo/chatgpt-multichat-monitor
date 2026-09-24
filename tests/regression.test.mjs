import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const copy = (value) => JSON.parse(JSON.stringify(value));

function event() {
  const listeners = [];
  return { listeners, addListener(fn) { listeners.push(fn); } };
}

function chromeMock({ stored = {}, storedSession = {}, tabs = [], offscreenCreateGate = null } = {}) {
  const storage = copy(stored);
  const sessionStorage = copy(storedSession);
  const currentTabs = copy(tabs);
  const offscreenState = { exists: false, createCount: 0 };
  const events = {
    runtimeMessage: event(), installed: event(), startup: event(),
    storageChanged: event(), command: event(), activated: event(),
    removed: event(), updated: event(), focusChanged: event()
  };

  const chrome = {
    storage: {
      local: {
        async get(defaults = {}) { return { ...copy(defaults), ...copy(storage) }; },
        async set(values) { Object.assign(storage, copy(values)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }
      },
      session: {
        async get(defaults = {}) { return { ...copy(defaults), ...copy(sessionStorage) }; },
        async set(values) { Object.assign(sessionStorage, copy(values)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStorage[key];
        }
      },
      onChanged: events.storageChanged
    },
    runtime: {
      onMessage: events.runtimeMessage,
      onInstalled: events.installed,
      onStartup: events.startup,
      getManifest() { return { version: manifest.version }; },
      async getContexts() { return []; },
      async sendMessage() { return {}; }
    },
    commands: { onCommand: events.command },
    tabs: {
      onActivated: events.activated,
      onRemoved: events.removed,
      onUpdated: events.updated,
      async query() { return copy(currentTabs); },
      async sendMessage() { return { initializing: true }; },
      async get(tabId) {
        const tab = currentTabs.find((item) => item.id === tabId);
        if (!tab) throw new Error("Unknown tab");
        return copy(tab);
      },
      async update() { return {}; }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.focusChanged,
      async get() { return { focused: true }; },
      async update() { return {}; }
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
      async setTitle() {}
    },
    scripting: { async executeScript() {} },
    offscreen: {
      async hasDocument() { return offscreenState.exists; },
      async createDocument() {
        offscreenState.createCount += 1;
        if (offscreenCreateGate) await offscreenCreateGate;
        offscreenState.exists = true;
      },
      async closeDocument() { offscreenState.exists = false; }
    }
  };

  return { chrome, storage, sessionStorage, events, offscreenState };
}

async function loadBackground(options = {}) {
  const mock = chromeMock(options);
  let timerId = 0;
  const sandbox = {
    chrome: mock.chrome, URL, Date, Math, JSON, console, crypto: globalThis.crypto,
    fetch: async () => ({ ok: false, status: 404, async json() { return {}; } }),
    setTimeout() { return ++timerId; },
    clearTimeout() {},
    setInterval() { return ++timerId; },
    clearInterval() {}
  };
  sandbox.globalThis = sandbox;

  const exportsSource =
    "\nglobalThis.__testApi = {" +
    " ensureInitialized, upsertState, activeRunForTab, queueActiveRunsPersist, chatKeyFromUrl," +
    " activateTab, setChatOrder, setChatPreference, prefsFor, handleTabUpdated, handleTabRemoved, rebuildRegistry, ensureOffscreen, snapshot," +
    " getChat(tabId) { return chats.get(tabId) || null; }" +
    "};";

  vm.createContext(sandbox);
  new vm.Script(backgroundSource + exportsSource, { filename: "background.js" }).runInContext(sandbox);
  await sandbox.__testApi.ensureInitialized();
  return { ...mock, api: sandbox.__testApi };
}

function functionSource(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, "Missing function " + name);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unterminated function " + name);
}

function contentFunction(name, dependencies = {}) {
  return vm.runInNewContext("(" + functionSource(contentSource, name) + ")", dependencies);
}

test("manifest remains scoped to ChatGPT", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://chatgpt.com/*"]);
  assert.equal("externally_connectable" in manifest, false);
  assert.equal("web_accessible_resources" in manifest, false);
});

test("concurrent sound requests share one offscreen creation", async () => {
  let releaseCreate;
  const gate = new Promise((resolve) => { releaseCreate = resolve; });
  const { api, offscreenState } = await loadBackground({ offscreenCreateGate: gate });

  const first = api.ensureOffscreen();
  const second = api.ensureOffscreen();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(offscreenState.createCount, 1);
  releaseCreate();
  await Promise.all([first, second]);
  assert.equal(offscreenState.exists, true);
});

test("content state sync is event-driven instead of heartbeat polling", () => {
  assert.doesNotMatch(contentSource, /HEARTBEAT_MS/);
  assert.doesNotMatch(contentSource, /setInterval\(\(\) => \{\s*sendCurrentState\(\)/);
  const injections = backgroundSource.match(/await injectIntoOpenTabs\(\)/g) || [];
  assert.equal(injections.length, 1);
});

test("content script keeps direct HTML/code execution sinks out", () => {
  assert.doesNotMatch(
    contentSource,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b|new\s+Function\s*\(/
  );
});

test("registry rebuild prunes orphan temporary tab preferences", async () => {
  const { api } = await loadBackground({
    stored: {
      monitorChatPrefs: {
        "tab:999": { alias: "Orphan" },
        "conversation:keep": { alias: "Keep" }
      },
      monitorChatOrder: ["tab:999", "conversation:keep"]
    },
    tabs: []
  });
  await api.rebuildRegistry();
  assert.equal(Object.keys(api.prefsFor("tab:999")).length, 0);
  assert.equal(api.prefsFor("conversation:keep").alias, "Keep");
});

test("chat identity prefers conversation id and falls back to tab id", async () => {
  const { api } = await loadBackground();
  assert.equal(api.chatKeyFromUrl("https://chatgpt.com/c/abc-123", 7), "conversation:abc-123");
  assert.equal(api.chatKeyFromUrl("https://chatgpt.com/", 7), "tab:7");
});

test("unchanged state refresh does not count as a snapshot change", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/dedupe";
  const tab = { id: 60, windowId: 1, url, title: "Dedupe" };
  const startedAt = Date.now() - 7_000;

  assert.equal(api.upsertState({ state: "working", url, startedAt, updatedAt: Date.now() }, tab), true);
  assert.equal(api.upsertState({ state: "working", url, startedAt, updatedAt: Date.now() + 30_000 }, tab), false);
});

test("Working heartbeat preserves the original run start", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/working";
  const tab = { id: 11, windowId: 1, url, title: "Regression" };
  const startedAt = Date.now() - 20_000;
  api.upsertState({ state: "working", url, startedAt }, tab);
  api.upsertState({ state: "working", url, startedAt: Date.now() }, tab);
  assert.equal(api.activeRunForTab(tab.id, "conversation:working").startedAt, startedAt);
});

test("Draft preserves the active run", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/draft";
  const tab = { id: 12, windowId: 1, url, title: "Regression" };
  const startedAt = Date.now() - 15_000;
  api.upsertState({ state: "working", url, startedAt }, tab);
  api.upsertState({ state: "draft", url }, tab);
  assert.equal(api.activeRunForTab(tab.id, "conversation:draft").startedAt, startedAt);
  assert.equal(api.getChat(tab.id).startedAt, startedAt);
});

test("Idle clears the active run", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/idle";
  const tab = { id: 13, windowId: 1, url, title: "Regression" };
  api.upsertState({ state: "working", url, startedAt: Date.now() - 5_000 }, tab);
  api.upsertState({ state: "idle", url }, tab);
  assert.equal(api.activeRunForTab(tab.id, "conversation:idle"), null);
  assert.equal(api.getChat(tab.id).startedAt, null);
});

test("terminal states clear the active run", async () => {
  for (const state of ["finished", "interrupted", "retry", "attention", "error"]) {
    const { api } = await loadBackground();
    const url = "https://chatgpt.com/c/" + state;
    const tab = { id: 20, windowId: 1, url, title: "Regression" };
    api.upsertState({ state: "working", url, startedAt: Date.now() - 5_000 }, tab);
    api.upsertState({ state, url }, tab);
    assert.equal(api.activeRunForTab(tab.id, "conversation:" + state), null, state);
  }
});

test("persisted run metadata survives service-worker initialization", async () => {
  const startedAt = Date.now() - 30_000;
  const { api } = await loadBackground({
    storedSession: {
      monitorActiveRuns: {
        "tab:31": {
          tabId: 31,
          chatKey: "conversation:restart",
          startedAt,
          workPhase: "Analyzing",
          phaseStartedAt: startedAt + 5_000,
          updatedAt: Date.now()
        }
      }
    }
  });
  const run = api.activeRunForTab(31, "conversation:restart");
  assert.equal(run.startedAt, startedAt);
  assert.equal(run.workPhase, "Analyzing");
  assert.equal(run.phaseStartedAt, startedAt + 5_000);
});


test("null persisted phase timestamp remains null", async () => {
  const startedAt = Date.now() - 10_000;
  const { api } = await loadBackground({
    storedSession: {
      monitorActiveRuns: {
        "tab:32": {
          tabId: 32,
          chatKey: "conversation:null-phase",
          startedAt,
          workPhase: "",
          phaseStartedAt: null,
          updatedAt: Date.now()
        }
      }
    }
  });
  assert.equal(api.activeRunForTab(32, "conversation:null-phase").phaseStartedAt, null);
});

test("phase classifier recognizes known visible labels", () => {
  const normalizeWorkPhaseText = contentFunction("normalizeWorkPhaseText");
  const classifyWorkPhaseText = contentFunction("classifyWorkPhaseText", { normalizeWorkPhaseText });
  assert.equal(classifyWorkPhaseText("Pensando"), "Analizando");
  assert.equal(classifyWorkPhaseText("Searching"), "Searching");
  assert.equal(classifyWorkPhaseText("Using tools"), "Executing");
});


test("phase detector sees ChatGPT Pensando shimmer span", () => {
  const normalizeWorkPhaseText = contentFunction("normalizeWorkPhaseText");
  const classifyWorkPhaseText = contentFunction("classifyWorkPhaseText", { normalizeWorkPhaseText });
  const span = {
    textContent: "Pensando",
    getAttribute() { return null; }
  };
  const latestTurn = {
    querySelectorAll(selector) {
      return selector.includes(".loading-shimmer-tertiary") ? [span] : [];
    }
  };
  const document = {
    querySelectorAll() { return [latestTurn]; }
  };
  const detectWorkPhase = contentFunction("detectWorkPhase", {
    document,
    isVisible: () => true,
    classifyWorkPhaseText
  });
  assert.equal(detectWorkPhase(), "Analizando");
});

test("attention detector keeps common English and Spanish prompts", () => {
  let text = "";
  const responseNeedsAttention = contentFunction("responseNeedsAttention", {
    latestAssistantText: () => text
  });
  text = "¿Quieres que continúe?";
  assert.equal(responseNeedsAttention(), true);
  text = "Would you like me to continue?";
  assert.equal(responseNeedsAttention(), true);
  text = "¿Te gustaría que lo haga?";
  assert.equal(responseNeedsAttention(), true);
});


test("By project honors manual chat order inside the same project", async () => {
  const { api } = await loadBackground({
    stored: {
      monitorGroupMode: "project",
      monitorChatOrder: ["conversation:b", "conversation:a"]
    }
  });
  const tabA = { id: 81, windowId: 1, url: "https://chatgpt.com/c/a", title: "A" };
  const tabB = { id: 82, windowId: 1, url: "https://chatgpt.com/c/b", title: "B" };
  for (const tab of [tabA, tabB]) {
    api.upsertState({
      state: "idle",
      url: tab.url,
      title: tab.title,
      projectKnown: true,
      projectKey: "project-1",
      projectName: "Project 1"
    }, tab);
  }
  assert.deepEqual(
    Array.from(api.snapshot(), (chat) => chat.chatKey),
    ["conversation:b", "conversation:a"]
  );
});

test("project drag remains inside the current project/pin group", () => {
  const projectSectionKey = contentFunction("projectSectionKey");
  const sameProjectDragGroup = contentFunction("sameProjectDragGroup", { projectSectionKey });
  const base = { projectKey: "alpha", projectKnown: true, pinned: false };
  assert.equal(sameProjectDragGroup(base, { ...base }), true);
  assert.equal(sameProjectDragGroup(base, { ...base, projectKey: "beta" }), false);
  assert.equal(sameProjectDragGroup(base, { ...base, pinned: true }), false);
});

test("render keeps visible rows attached between snapshots", () => {
  const source = functionSource(contentSource, "render");
  assert.match(source, /const desiredRowIds = new Set\(\)/);
  assert.doesNotMatch(source, /else\s*\{\s*node\.row\.remove\(\)/);
});


test("project chat dragover validates destination without relying on render-local scope", () => {
  const lookup = {
    "c:conversation:a": { projectKey: "alpha", projectKnown: true, pinned: false },
    "c:conversation:b": { projectKey: "alpha", projectKnown: true, pinned: false },
    "c:conversation:c": { projectKey: "beta", projectKnown: true, pinned: false }
  };
  const projectSectionKey = contentFunction("projectSectionKey");
  const sameProjectDragGroup = contentFunction("sameProjectDragGroup", { projectSectionKey });
  const projectChatDropAllowed = contentFunction("projectChatDropAllowed", {
    activeGroupMode: () => "project",
    chatForLayoutToken: (token) => lookup[token] || null,
    sameProjectDragGroup
  });

  assert.equal(projectChatDropAllowed("c:conversation:a", "c:conversation:b"), true);
  assert.equal(projectChatDropAllowed("c:conversation:a", "c:conversation:c"), false);
  assert.equal(projectChatDropAllowed("c:conversation:a", "p:project:alpha"), false);

  const buildOverlaySource = functionSource(contentSource, "buildOverlay");
  assert.match(buildOverlaySource, /projectChatDropAllowed\(draggedToken, targetToken\)/);
  assert.doesNotMatch(buildOverlaySource, /\bmode\s*===\s*["']project["']/);
});

test("project drop-after marker targets the end of the project group", () => {
  const source = functionSource(contentSource, "projectDropVisualTarget");
  assert.match(source, /projectRows\[projectRows\.length - 1\]/);
});

test("drag payloads do not expose chat or section identifiers", () => {
  const setDataCalls = contentSource.match(/setData\("text\/plain", "monitor-layout-drag"\)/g) || [];
  assert.equal(setDataCalls.length, 2);
  assert.doesNotMatch(contentSource, /setData\("text\/plain", dragged(?:ChatKey|SectionToken)\)/);
});

test("synthetic events are blocked at the monitor boundary", () => {
  const blockUntrustedEvent = contentFunction("blockUntrustedEvent");
  let prevented = false;
  let stopped = false;
  blockUntrustedEvent({
    isTrusted: false,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.match(functionSource(contentSource, "buildOverlay"), /attachShadow\(\{ mode: "closed" \}\)/);
});

test("locked layout gestures signal the closed lock", () => {
  const helper = functionSource(contentSource, "signalLayoutLocked");
  assert.match(helper, /lock-feedback/);
  assert.match(helper, /offsetWidth/);
  assert.match(contentSource, /@keyframes lockshake/);
  assert.match(functionSource(contentSource, "buildOverlay"), /blockedLayoutTarget/);
  assert.match(functionSource(contentSource, "buildOverlay"), /signalLayoutLocked\(\)/);
});

test("layout lock is enforced by background mutations", async () => {
  const { api } = await loadBackground({ stored: { monitorLayoutLocked: true } });
  const result = await api.setChatOrder(["conversation:locked"]);
  assert.equal(result.ok, false);
  assert.equal(result.locked, true);
});
test("Idle duplicate tab cannot clear sibling Working run", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/shared-idle";
  const workingTab = { id: 41, windowId: 1, url, title: "Working" };
  const idleTab = { id: 42, windowId: 1, url, title: "Idle" };
  const startedAt = Date.now() - 8_000;
  api.upsertState({ state: "working", url, startedAt }, workingTab);
  api.upsertState({ state: "idle", url }, idleTab);
  assert.equal(api.activeRunForTab(workingTab.id, "conversation:shared-idle").startedAt, startedAt);
});
test("Done duplicate tab cannot clear sibling Working run", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/shared-done";
  const tabA = { id: 43, windowId: 1, url, title: "A" };
  const tabB = { id: 44, windowId: 1, url, title: "B" };
  const startA = Date.now() - 12_000;
  const startB = Date.now() - 3_000;
  api.upsertState({ state: "working", url, startedAt: startA }, tabA);
  api.upsertState({ state: "working", url, startedAt: startB }, tabB);
  assert.equal(api.activeRunForTab(tabA.id, "conversation:shared-done").startedAt, startA);
  assert.equal(api.activeRunForTab(tabB.id, "conversation:shared-done").startedAt, startB);
  api.upsertState({ state: "finished", url }, tabB);
  assert.equal(api.activeRunForTab(tabA.id, "conversation:shared-done").startedAt, startA);
  assert.equal(api.activeRunForTab(tabB.id, "conversation:shared-done"), null);
});
test("discarded tabs clear stale active runs instead of refreshing TTL", async () => {
  const now = Date.now();
  const tab = {
    id: 51,
    windowId: 1,
    url: "https://chatgpt.com/c/discarded",
    title: "Discarded",
    discarded: true
  };
  const { api } = await loadBackground({
    tabs: [tab],
    storedSession: {
      monitorActiveRuns: {
        "tab:51": {
          tabId: 51,
          chatKey: "conversation:discarded",
          startedAt: now - 60_000,
          workPhase: "Analyzing",
          phaseStartedAt: now - 30_000,
          updatedAt: now - 23 * 60 * 60 * 1000
        }
      }
    }
  });
  await api.rebuildRegistry();
  assert.equal(api.activeRunForTab(tab.id, "conversation:discarded"), null);
  assert.equal(api.getChat(tab.id).state, "idle");
});
test("tab removal initializes state before clearing its owned run", async () => {
  const tab = { id: 52, windowId: 1, url: "https://chatgpt.com/c/remove", title: "Remove" };
  const startedAt = Date.now() - 5_000;
  const { api } = await loadBackground({
    tabs: [tab],
    storedSession: {
      monitorActiveRuns: {
        "tab:52": {
          tabId: 52,
          chatKey: "conversation:remove",
          startedAt,
          workPhase: "",
          phaseStartedAt: null,
          updatedAt: Date.now()
        }
      }
    }
  });
  await api.handleTabRemoved(tab.id);
  assert.equal(api.activeRunForTab(tab.id, "conversation:remove"), null);
  assert.match(functionSource(backgroundSource, "handleTabRemoved"), /await ensureInitialized\(\)/);
});
test("monitor tab activation rejects unregistered or non-ChatGPT tabs", async () => {
  const external = { id: 70, windowId: 1, url: "https://example.com/", title: "External" };
  const unregistered = await loadBackground({ tabs: [external] });
  assert.equal(await unregistered.api.activateTab(external.id), false);

  const chatgpt = { id: 71, windowId: 1, url: "https://chatgpt.com/c/allowed", title: "Allowed" };
  const registered = await loadBackground({ tabs: [chatgpt] });
  registered.api.upsertState({ state: "idle", url: chatgpt.url }, chatgpt);
  assert.equal(await registered.api.activateTab(chatgpt.id), true);
});
test("new-chat / -> /c/<id> preserves run and migrates temporary prefs", async () => {
  const tab = { id: 45, windowId: 1, url: "https://chatgpt.com/", title: "New chat" };
  const { api } = await loadBackground({ tabs: [tab] });
  const startedAt = Date.now() - 9_000;
  api.upsertState({ state: "working", url: tab.url, startedAt }, tab);
  await api.setChatPreference("tab:45", { alias: "Temporary alias", pending: true });

  const nextTab = { ...tab, url: "https://chatgpt.com/c/new-id", title: "Named chat" };
  await api.handleTabUpdated(tab.id, { status: "loading", url: nextTab.url }, nextTab);

  assert.equal(api.getChat(tab.id).chatKey, "conversation:new-id");
  assert.equal(api.getChat(tab.id).state, "working");
  assert.equal(api.activeRunForTab(tab.id, "conversation:new-id").startedAt, startedAt);
  assert.equal(api.prefsFor("conversation:new-id").alias, "Temporary alias");
  assert.equal(Object.keys(api.prefsFor("tab:45")).length, 0);
});
