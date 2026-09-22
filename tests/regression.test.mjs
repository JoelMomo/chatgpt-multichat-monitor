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

function chromeMock({ stored = {}, tabs = [] } = {}) {
  const storage = copy(stored);
  const currentTabs = copy(tabs);
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
      async hasDocument() { return false; },
      async createDocument() {},
      async closeDocument() {}
    }
  };

  return { chrome, storage, events };
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
    " ensureInitialized, upsertState, activeRunFor, queueActiveRunsPersist, chatKeyFromUrl," +
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

test("content script keeps direct HTML/code execution sinks out", () => {
  assert.doesNotMatch(
    contentSource,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b|new\s+Function\s*\(/
  );
});

test("chat identity prefers conversation id and falls back to tab id", async () => {
  const { api } = await loadBackground();
  assert.equal(api.chatKeyFromUrl("https://chatgpt.com/c/abc-123", 7), "conversation:abc-123");
  assert.equal(api.chatKeyFromUrl("https://chatgpt.com/", 7), "tab:7");
});

test("Working heartbeat preserves the original run start", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/working";
  const tab = { id: 11, windowId: 1, url, title: "Regression" };
  const startedAt = Date.now() - 20_000;
  api.upsertState({ state: "working", url, startedAt }, tab);
  api.upsertState({ state: "working", url, startedAt: Date.now() }, tab);
  assert.equal(api.activeRunFor("conversation:working").startedAt, startedAt);
});

test("Draft preserves the active run", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/draft";
  const tab = { id: 12, windowId: 1, url, title: "Regression" };
  const startedAt = Date.now() - 15_000;
  api.upsertState({ state: "working", url, startedAt }, tab);
  api.upsertState({ state: "draft", url }, tab);
  assert.equal(api.activeRunFor("conversation:draft").startedAt, startedAt);
  assert.equal(api.getChat(tab.id).startedAt, startedAt);
});

test("Idle clears the active run", async () => {
  const { api } = await loadBackground();
  const url = "https://chatgpt.com/c/idle";
  const tab = { id: 13, windowId: 1, url, title: "Regression" };
  api.upsertState({ state: "working", url, startedAt: Date.now() - 5_000 }, tab);
  api.upsertState({ state: "idle", url }, tab);
  assert.equal(api.activeRunFor("conversation:idle"), null);
  assert.equal(api.getChat(tab.id).startedAt, null);
});

test("terminal states clear the active run", async () => {
  for (const state of ["finished", "interrupted", "retry", "attention", "error"]) {
    const { api } = await loadBackground();
    const url = "https://chatgpt.com/c/" + state;
    const tab = { id: 20, windowId: 1, url, title: "Regression" };
    api.upsertState({ state: "working", url, startedAt: Date.now() - 5_000 }, tab);
    api.upsertState({ state, url }, tab);
    assert.equal(api.activeRunFor("conversation:" + state), null, state);
  }
});

test("persisted run metadata survives service-worker initialization", async () => {
  const startedAt = Date.now() - 30_000;
  const { api } = await loadBackground({
    stored: {
      monitorActiveRuns: {
        "conversation:restart": {
          startedAt,
          workPhase: "Analyzing",
          phaseStartedAt: startedAt + 5_000,
          updatedAt: Date.now()
        }
      }
    }
  });
  const run = api.activeRunFor("conversation:restart");
  assert.equal(run.startedAt, startedAt);
  assert.equal(run.workPhase, "Analyzing");
  assert.equal(run.phaseStartedAt, startedAt + 5_000);
});

test("phase classifier recognizes known visible labels", () => {
  const normalizeWorkPhaseText = contentFunction("normalizeWorkPhaseText");
  const classifyWorkPhaseText = contentFunction("classifyWorkPhaseText", { normalizeWorkPhaseText });
  assert.equal(classifyWorkPhaseText("Pensando"), "Analizando");
  assert.equal(classifyWorkPhaseText("Searching"), "Searching");
  assert.equal(classifyWorkPhaseText("Using tools"), "Executing");
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
});

test.todo("phase candidates include ChatGPT loading-shimmer-tertiary Pensando span");
test.todo("accented Spanish '¿Te gustaría que...?' is detected as Needs attention");
test.todo("synthetic page events cannot trigger monitor actions");
test.todo("layout lock is enforced by background");
test.todo("Idle duplicate tab cannot clear sibling Working run");
test.todo("Done duplicate tab cannot clear sibling Working run");
test.todo("discarded tabs cannot refresh stale active-run TTL");
test.todo("cold-start tab removal waits for active-run initialization");
test.todo("monitor-activate-tab rejects unregistered or non-ChatGPT tabs");
test.todo("new-chat / -> /c/<id> has automated browser-level regression");
