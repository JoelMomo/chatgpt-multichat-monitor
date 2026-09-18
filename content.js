(() => {
  if (globalThis.__chatgptMultichatMonitorLoaded) return;
  globalThis.__chatgptMultichatMonitorLoaded = true;

  const FINISH_CONFIRM_MS = 1400;
  const RECENT_TTL_MS = 180000;
  const HEARTBEAT_MS = 15000;
  const DEFAULTS = {
    monitorEnabled: true,
    monitorShowIdle: false,
    monitorCollapsed: false,
    monitorPosition: null
  };

  let localState = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    updatedAt: Date.now()
  };
  let finishTimer = null;
  let recentResetTimer = null;
  let manualStopUntil = 0;
  let lastUrl = location.href;
  let lastTitle = document.title;
  let chats = [];
  let settings = { ...DEFAULTS };
  let host = null;
  let panel = null;
  let header = null;
  let list = null;
  let empty = null;
  let count = null;
  let collapseButton = null;
  let dragging = null;
  const rowNodes = new Map();

  function isVisible(element) {
    return !!element &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function isStopButton(button) {
    if (!button) return false;
    if (button.getAttribute("data-testid") === "stop-button") return true;
    const label = ((button.getAttribute("aria-label") || "") + " " + (button.textContent || ""))
      .trim()
      .toLowerCase();
    return /(^|\s)(stop|detener|cancel|cancelar)(\s|$)/i.test(label) &&
      /(generat|response|respuesta|thinking|pensando|generacion|generaci)/i.test(label);
  }

  function isWorking() {
    const direct = document.querySelector(
      'button[data-testid="stop-button"], [data-testid="stop-button"]'
    );
    if (isVisible(direct)) return true;
    for (const button of document.querySelectorAll("button")) {
      if (isVisible(button) && isStopButton(button)) return true;
    }
    return false;
  }

  function clearFinishTimer() {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = null;
  }

  function clearRecentResetTimer() {
    if (recentResetTimer) clearTimeout(recentResetTimer);
    recentResetTimer = null;
  }

  function statePayload() {
    return {
      type: "monitor-state",
      title: document.title,
      url: location.href,
      state: localState.state,
      startedAt: localState.startedAt,
      finishedAt: localState.finishedAt,
      updatedAt: localState.updatedAt
    };
  }

  function sendCurrentState() {
    try {
      chrome.runtime.sendMessage(statePayload()).catch(() => {});
    } catch {}
  }

  function setState(state, values) {
    const now = Date.now();
    const extra = values || {};
    localState = {
      state,
      startedAt: Object.prototype.hasOwnProperty.call(extra, "startedAt")
        ? extra.startedAt
        : localState.startedAt,
      finishedAt: Object.prototype.hasOwnProperty.call(extra, "finishedAt")
        ? extra.finishedAt
        : localState.finishedAt,
      updatedAt: now
    };

    if (state === "idle") {
      localState.startedAt = null;
      localState.finishedAt = null;
    }

    clearRecentResetTimer();
    if (state === "finished" || state === "interrupted") {
      recentResetTimer = setTimeout(() => {
        if (localState.state === state) setState("idle");
      }, RECENT_TTL_MS);
    }

    sendCurrentState();
  }

  function evaluate() {
    const urlChanged = location.href !== lastUrl;
    const titleChanged = document.title !== lastTitle;

    if (urlChanged) {
      lastUrl = location.href;
      clearFinishTimer();
      if (localState.state !== "working") setState("idle");
      else sendCurrentState();
    }
    if (titleChanged) {
      lastTitle = document.title;
      sendCurrentState();
    }

    const working = isWorking();

    if (working) {
      clearFinishTimer();
      if (localState.state !== "working") {
        clearRecentResetTimer();
        setState("working", {
          startedAt: Date.now(),
          finishedAt: null
        });
      }
      return;
    }

    if (localState.state !== "working" || finishTimer) return;

    finishTimer = setTimeout(() => {
      finishTimer = null;
      if (isWorking() || localState.state !== "working") return;
      const stopped = Date.now() < manualStopUntil;
      setState(stopped ? "interrupted" : "finished", {
        finishedAt: Date.now()
      });
    }, FINISH_CONFIRM_MS);
  }

  function formatElapsed(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return seconds + "s";
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return minutes + ":" + String(rest).padStart(2, "0");
    const hours = Math.floor(minutes / 60);
    return hours + "h " + (minutes % 60) + "m";
  }

  function statusText(chat, now) {
    if (chat.state === "working") {
      return "Working " + formatElapsed(now - (chat.startedAt || chat.updatedAt || now));
    }
    if (chat.state === "finished") {
      return "Done " + formatElapsed(now - (chat.finishedAt || chat.updatedAt || now)) + " ago";
    }
    if (chat.state === "interrupted") {
      return "Stopped " + formatElapsed(now - (chat.finishedAt || chat.updatedAt || now)) + " ago";
    }
    return "Idle";
  }

  function isRecent(chat, now) {
    if (chat.state === "working") return true;
    if (chat.state === "finished" || chat.state === "interrupted") {
      return now - (chat.finishedAt || chat.updatedAt || 0) < RECENT_TTL_MS;
    }
    return settings.monitorShowIdle === true;
  }

  function rank(chat) {
    return ({ working: 0, finished: 1, interrupted: 2, idle: 3 })[chat.state] ?? 9;
  }

  function createRow(tabId) {
    const row = document.createElement("button");
    row.className = "chat-row";
    row.type = "button";
    row.dataset.tabId = String(tabId);

    const dot = document.createElement("span");
    dot.className = "dot";
    const copy = document.createElement("span");
    copy.className = "copy";
    const title = document.createElement("span");
    title.className = "chat-title";
    const meta = document.createElement("span");
    meta.className = "meta";
    copy.append(title, meta);
    row.append(dot, copy);

    row.addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({
          type: "monitor-activate-tab",
          tabId: Number(row.dataset.tabId)
        }).catch(() => {});
      } catch {}
    });

    rowNodes.set(tabId, { row, dot, title, meta });
    return rowNodes.get(tabId);
  }

  function render() {
    if (!panel) return;
    host.style.display = settings.monitorEnabled === false ? "none" : "block";
    if (settings.monitorEnabled === false) return;

    panel.classList.toggle("collapsed", settings.monitorCollapsed === true);
    collapseButton.textContent = settings.monitorCollapsed ? "+" : "-";
    collapseButton.title = settings.monitorCollapsed ? "Expand monitor" : "Collapse monitor";

    const now = Date.now();
    const visible = chats
      .filter((chat) => isRecent(chat, now))
      .sort((a, b) => rank(a) - rank(b) || (b.updatedAt || 0) - (a.updatedAt || 0));

    const active = chats.filter((chat) => chat.state === "working").length;
    count.textContent = active ? String(active) : "0";
    count.classList.toggle("active", active > 0);

    const visibleIds = new Set(visible.map((chat) => chat.tabId));
    for (const [tabId, node] of rowNodes) {
      if (!visibleIds.has(tabId)) {
        node.row.remove();
        rowNodes.delete(tabId);
      }
    }

    for (const chat of visible) {
      const node = rowNodes.get(chat.tabId) || createRow(chat.tabId);
      node.row.className = "chat-row state-" + chat.state;
      if (chat.url === location.href) node.row.classList.add("current");
      node.title.textContent = chat.title || "ChatGPT";
      node.meta.textContent = statusText(chat, now);
      node.row.setAttribute("aria-label", (chat.title || "ChatGPT") + ", " + node.meta.textContent);
      list.appendChild(node.row);
    }

    empty.hidden = visible.length > 0;
  }

  function clampPosition(x, y) {
    const width = panel ? panel.offsetWidth || 318 : 318;
    const height = panel ? panel.offsetHeight || 80 : 80;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - Math.min(height, 80) - 8))
    };
  }

  function applyPosition(position) {
    if (!panel) return;
    const fallback = {
      x: Math.max(8, window.innerWidth - 334),
      y: 72
    };
    const pos = position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? position
      : fallback;
    const safe = clampPosition(pos.x, pos.y);
    panel.style.left = safe.x + "px";
    panel.style.top = safe.y + "px";
  }

  function setupDrag() {
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging = {
        pointerId: event.pointerId,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
      };
      header.setPointerCapture(event.pointerId);
      panel.classList.add("dragging");
      event.preventDefault();
    });

    header.addEventListener("pointermove", (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      const pos = clampPosition(event.clientX - dragging.dx, event.clientY - dragging.dy);
      panel.style.left = pos.x + "px";
      panel.style.top = pos.y + "px";
    });

    header.addEventListener("pointerup", (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      dragging = null;
      panel.classList.remove("dragging");
      const rect = panel.getBoundingClientRect();
      chrome.storage.local.set({
        monitorPosition: { x: Math.round(rect.left), y: Math.round(rect.top) }
      });
    });
  }

  function buildOverlay() {
    if (host) return;

    host = document.createElement("div");
    host.id = "chatgpt-multichat-monitor-host";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent =
      ":host{all:initial}" +
      "*{box-sizing:border-box}" +
      "#panel{position:fixed;width:318px;max-height:min(480px,70vh);overflow:hidden;pointer-events:auto;" +
      "font:13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;color:#f5f7fa;background:rgba(18,23,31,.96);" +
      "border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 55px rgba(0,0,0,.38);backdrop-filter:blur(16px)}" +
      "#panel.dragging{user-select:none;box-shadow:0 22px 65px rgba(0,0,0,.48)}" +
      ".head{height:46px;display:flex;align-items:center;gap:9px;padding:0 10px 0 12px;cursor:grab;border-bottom:1px solid rgba(255,255,255,.09)}" +
      ".head:active{cursor:grabbing}.brand{font-weight:750;letter-spacing:-.01em;flex:1}.badge{min-width:22px;height:22px;padding:0 6px;display:grid;place-items:center;" +
      "border-radius:999px;background:#303846;color:#aeb8c7;font-size:11px;font-weight:800}.badge.active{background:#194d47;color:#73f0df}" +
      ".collapse{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#aeb8c7;font-size:18px;line-height:1;cursor:pointer}" +
      ".collapse:hover{background:rgba(255,255,255,.08);color:white}.list{max-height:min(360px,58vh);overflow:auto;padding:7px}" +
      ".chat-row{width:100%;display:flex;align-items:center;gap:10px;border:0;border-radius:10px;padding:9px 10px;background:transparent;color:inherit;text-align:left;cursor:pointer}" +
      ".chat-row:hover{background:rgba(255,255,255,.065)}.chat-row.current{background:rgba(255,255,255,.045)}" +
      ".dot{width:9px;height:9px;border-radius:50%;background:#687386;flex:0 0 auto}.state-working .dot{background:#63e6d7;box-shadow:0 0 0 4px rgba(99,230,215,.09);animation:pulse 1.35s ease-in-out infinite}" +
      ".state-finished .dot{background:#72d99b}.state-interrupted .dot{background:#f2bd68}.copy{min-width:0;display:flex;flex-direction:column;gap:1px;flex:1}" +
      ".chat-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.meta{color:#8e9bad;font-size:11px}" +
      ".empty{padding:18px 14px 20px;color:#8e9bad;text-align:center;font-size:12px}.foot{padding:8px 12px 10px;color:#6f7c8e;text-align:center;font-size:10px;border-top:1px solid rgba(255,255,255,.07)}" +
      "#panel.collapsed{width:196px}.collapsed .list,.collapsed .empty,.collapsed .foot{display:none}.collapsed .head{border-bottom:0}" +
      "@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.82)}}";

    panel = document.createElement("section");
    panel.id = "panel";

    header = document.createElement("div");
    header.className = "head";
    const brand = document.createElement("div");
    brand.className = "brand";
    brand.textContent = "ChatGPT Monitor";
    count = document.createElement("div");
    count.className = "badge";
    collapseButton = document.createElement("button");
    collapseButton.className = "collapse";
    collapseButton.type = "button";
    header.append(brand, count, collapseButton);

    list = document.createElement("div");
    list.className = "list";
    empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No active chats";
    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "Click a chat to switch tabs";

    panel.append(header, list, empty, foot);
    shadow.append(style, panel);
    document.documentElement.appendChild(host);

    collapseButton.addEventListener("click", () => {
      settings.monitorCollapsed = !settings.monitorCollapsed;
      chrome.storage.local.set({ monitorCollapsed: settings.monitorCollapsed });
      render();
    });

    setupDrag();
    applyPosition(settings.monitorPosition);
    render();
  }

  async function loadSettings() {
    try {
      settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    } catch {
      settings = { ...DEFAULTS };
    }
  }

  async function requestSnapshot() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "monitor-get-snapshot" });
      if (response && Array.isArray(response.chats)) {
        chats = response.chats;
        render();
      }
    } catch {}
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (isStopButton(target)) manualStopUntil = Date.now() + 5000;
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "monitor-snapshot" && Array.isArray(message.chats)) {
      chats = message.chats;
      render();
      return;
    }
    if (message?.type === "monitor-get-local-state") {
      sendResponse({
        title: document.title,
        url: location.href,
        state: localState.state,
        startedAt: localState.startedAt,
        finishedAt: localState.finishedAt,
        updatedAt: localState.updatedAt
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    if (changes.monitorPosition) applyPosition(settings.monitorPosition);
    render();
  });

  const observer = new MutationObserver(evaluate);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "data-testid", "disabled"]
  });

  window.addEventListener("resize", () => {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    applyPosition({ x: rect.left, y: rect.top });
  });

  setInterval(evaluate, 1000);
  setInterval(() => {
    sendCurrentState();
    requestSnapshot();
  }, HEARTBEAT_MS);
  setInterval(render, 1000);

  (async () => {
    await loadSettings();
    buildOverlay();
    evaluate();
    sendCurrentState();
    await requestSnapshot();
  })();
})();
