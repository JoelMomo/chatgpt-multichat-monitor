const chats = new Map();

function cleanTitle(title) {
  const value = String(title || "")
    .replace(/\s+(?:-||)\s+ChatGPT\s*$/i, "")
    .trim();
  return value && value.toLowerCase() !== "chatgpt" ? value : "ChatGPT";
}

function snapshot() {
  return [...chats.values()].sort((a, b) => {
    const rank = { working: 0, finished: 1, interrupted: 2, idle: 3 };
    const byState = (rank[a.state] ?? 9) - (rank[b.state] ?? 9);
    return byState || (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function upsertState(payload, tab) {
  if (!tab || !Number.isInteger(tab.id)) return;
  const now = Date.now();
  const previous = chats.get(tab.id) || {};

  let startedAt = payload.startedAt ?? previous.startedAt ?? null;
  let finishedAt = payload.finishedAt ?? previous.finishedAt ?? null;

  if (payload.state === "working" && previous.state !== "working" && !payload.startedAt) {
    startedAt = now;
    finishedAt = null;
  }
  if ((payload.state === "finished" || payload.state === "interrupted") && !finishedAt) {
    finishedAt = now;
  }
  if (payload.state === "idle") {
    startedAt = null;
    finishedAt = null;
  }

  chats.set(tab.id, {
    tabId: tab.id,
    windowId: tab.windowId,
    title: cleanTitle(payload.title || tab.title),
    url: payload.url || tab.url || "",
    state: payload.state || "idle",
    startedAt,
    finishedAt,
    updatedAt: payload.updatedAt || now
  });
}

async function broadcast() {
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
}

async function rebuildRegistry() {
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
    upsertState(message, sender.tab);
    broadcast().catch(() => {});
    sendResponse({ ok: true });
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
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!chats.delete(tabId)) return;
  broadcast().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (!changeInfo.url.startsWith("https://chatgpt.com/")) {
    if (chats.delete(tabId)) broadcast().catch(() => {});
    return;
  }
  const previous = chats.get(tabId);
  if (previous) {
    chats.set(tabId, {
      ...previous,
      title: cleanTitle(tab.title || previous.title),
      url: changeInfo.url,
      updatedAt: Date.now()
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenTabs().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenTabs().catch(() => {});
});

injectIntoOpenTabs().catch(() => {});
