(() => {
  if (globalThis.__chatgptMultichatMonitorV2Loaded) return;
  globalThis.__chatgptMultichatMonitorV2Loaded = true;

  const FINISH_CONFIRM_MS = 1400;
  const RECENT_TTL_MS = 180000;
  const ATTENTION_TTL_MS = 30 * 60 * 1000;
  const ERROR_TTL_MS = 10 * 60 * 1000;
  const FALLBACK_SCAN_MS = 5000;
  const HEARTBEAT_MS = 30000;
  const MUTATION_THROTTLE_MS = 500;
  const ERROR_SCAN_MS = 1000;
  const LATE_ISSUE_GRACE_MS = 10000;

  const DEFAULTS = {
    monitorEnabled: true,
    monitorShowIdle: false,
    monitorCollapsed: false,
    monitorCompact: false,
    monitorAnimations: true,
    monitorPosition: null
  };

  let localState = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    updatedAt: Date.now()
  };

  let settings = { ...DEFAULTS };
  let chats = [];
  let finishTimer = null;
  let resetTimer = null;
  let evaluationTimer = null;
  let lastFallbackScanAt = 0;
  let lastErrorScanAt = 0;
  let manualStopUntil = 0;
  let lastUrl = location.href;
  let lastTitle = document.title;
  let host = null;
  let panel = null;
  let header = null;
  let list = null;
  let empty = null;
  let badge = null;
  let summary = null;
  let collapseButton = null;
  let dragging = null;
  let openMenuTabId = null;
  let floatingMenu = null;
  let draggedChatKey = null;
  let draggedPinned = null;
  let dropTarget = null;

  const rowNodes = new Map();
  const renderedStates = new Map();

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
    return /(^|\s)(stop|cancel|detener|cancelar)(\s|$)/i.test(label) &&
      /(generat|response|respuesta|thinking|pensando|generacion)/i.test(label);
  }

  function directWorkingSignal() {
    const direct = document.querySelector(
      'button[data-testid="stop-button"], [data-testid="stop-button"]'
    );
    return isVisible(direct);
  }

  function fallbackWorkingSignal() {
    const now = Date.now();
    if (now - lastFallbackScanAt < FALLBACK_SCAN_MS) return false;
    lastFallbackScanAt = now;

    for (const button of document.querySelectorAll("button")) {
      if (isVisible(button) && isStopButton(button)) return true;
    }
    return false;
  }

  function detectWorking(allowFallback) {
    if (directWorkingSignal()) return true;
    return allowFallback ? fallbackWorkingSignal() : false;
  }

  function classifyIssueText(text) {
    const value = String(text || "").trim().slice(0, 700);
    if (!value) return null;

    if (/(try again|retry|reintentar|vuelve a intentarlo|vuelva a intentarlo|timed out|timeout|time out|se ha agotado el tiempo|delivery timed out|message delivery|network error|connection lost|reconnect|rate limit|too many requests|failed to send)/i.test(value)) {
      return "retry";
    }

    if (/(something went wrong|error generating|internal server error|service unavailable|ha ocurrido un error|error al generar|error de servidor)/i.test(value)) {
      return "error";
    }

    return null;
  }

  function isOnScreen(element) {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function detectVisibleIssue(force) {
    const now = Date.now();
    if (!force && now - lastErrorScanAt < ERROR_SCAN_MS) return null;
    lastErrorScanAt = now;

    const candidates = document.querySelectorAll(
      '[role="alert"], [data-testid*="error"], [data-testid*="retry"]'
    );

    let checked = 0;
    for (const element of candidates) {
      if (++checked > 20) break;
      if (!isOnScreen(element)) continue;
      const issue = classifyIssueText(element.textContent);
      if (issue) return issue;
    }

    if (localState.state !== "idle") {
      checked = 0;
      for (const button of document.querySelectorAll("button")) {
        if (++checked > 80) break;
        if (!isOnScreen(button)) continue;
        const label = (button.getAttribute("aria-label") || "") + " " + (button.textContent || "");
        const issue = classifyIssueText(label);
        if (issue) return issue;
      }
    }

    return null;
  }

  function latestAssistantText() {
    const turns = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!turns.length) return "";
    const text = String(turns[turns.length - 1].textContent || "").trim();
    return text.slice(-700);
  }

  function responseNeedsAttention() {
    const text = latestAssistantText();
    if (!text) return false;
    if (/\?\s*$/.test(text)) return true;
    return /(would you like me to|do you want me to|shall i|want me to|quieres que|te gustaria que|te gustarÃƒÂ­a que|prefieres que|debo hacerlo)/i.test(text);
  }

  function clearFinishTimer() {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = null;
  }

  function clearResetTimer() {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
  }

  function resetDelayFor(state) {
    if (state === "retry" || state === "attention") return ATTENTION_TTL_MS;
    if (state === "error") return ERROR_TTL_MS;
    if (state === "interrupted") return RECENT_TTL_MS;
    return 0;
  }

  function scheduleResetForCurrentState() {
    clearResetTimer();
    const state = localState.state;
    const delay = resetDelayFor(state);
    if (delay <= 0) return;

    const elapsed = localState.finishedAt
      ? Math.max(0, Date.now() - localState.finishedAt)
      : 0;
    const remaining = Math.max(0, delay - elapsed);

    if (remaining === 0) {
      setState("idle");
      return;
    }

    resetTimer = setTimeout(() => {
      if (localState.state === state) setState("idle");
    }, remaining);
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
    const extra = values || {};
    if (localState.state === state &&
        !Object.prototype.hasOwnProperty.call(extra, "startedAt") &&
        !Object.prototype.hasOwnProperty.call(extra, "finishedAt")) {
      return;
    }

    localState = {
      state,
      startedAt: Object.prototype.hasOwnProperty.call(extra, "startedAt")
        ? extra.startedAt
        : localState.startedAt,
      finishedAt: Object.prototype.hasOwnProperty.call(extra, "finishedAt")
        ? extra.finishedAt
        : localState.finishedAt,
      updatedAt: Date.now()
    };

    if (state === "idle") {
      localState.startedAt = null;
      localState.finishedAt = null;
    }

    scheduleResetForCurrentState();
    sendCurrentState();
  }

  function evaluate(options) {
    const opts = options || {};
    const allowFallback = opts.allowFallback === true;
    const urlChanged = location.href !== lastUrl;
    const titleChanged = document.title !== lastTitle;

    if (urlChanged) {
      lastUrl = location.href;
      clearFinishTimer();
      clearResetTimer();
      manualStopUntil = 0;
      lastErrorScanAt = 0;
      lastFallbackScanAt = 0;
      setState("idle");
    }

    if (titleChanged) {
      lastTitle = document.title;
      sendCurrentState();
    }

    const working = detectWorking(allowFallback);

    // Active generation wins over stale retry/error UI left behind by ChatGPT.
    if (working) {
      clearFinishTimer();
      if (localState.state !== "working") {
        clearResetTimer();
        setState("working", {
          startedAt: Date.now(),
          finishedAt: null
        });
      }
      return;
    }

    const canHaveLateIssue =
      localState.state !== "idle" &&
      (localState.state !== "finished" ||
        Date.now() - (localState.finishedAt || localState.updatedAt || 0) <= LATE_ISSUE_GRACE_MS);

    const issue = canHaveLateIssue
      ? detectVisibleIssue(false)
      : null;

    if (issue) {
      clearFinishTimer();
      if (localState.state !== issue) {
        setState(issue, {
          finishedAt: localState.finishedAt || Date.now()
        });
      }
      return;
    }

    if (localState.state !== "working" || finishTimer) return;

    finishTimer = setTimeout(() => {
      finishTimer = null;
      if (detectWorking(true) || localState.state !== "working") return;

      const stopped = Date.now() < manualStopUntil;
      if (stopped) {
        setState("interrupted", { finishedAt: Date.now() });
        return;
      }

      const issue = detectVisibleIssue(true);
      if (issue) {
        setState(issue, { finishedAt: Date.now() });
        return;
      }

      setState(responseNeedsAttention() ? "attention" : "finished", {
        finishedAt: Date.now()
      });
    }, FINISH_CONFIRM_MS);
  }

  function scheduleEvaluate() {
    if (evaluationTimer) return;
    evaluationTimer = setTimeout(() => {
      evaluationTimer = null;
      evaluate({ allowFallback: false });
    }, MUTATION_THROTTLE_MS);
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

  function stateName(state) {
    return ({
      working: "Working",
      retry: "Retry needed",
      attention: "Needs attention",
      error: "Error",
      finished: "Done",
      interrupted: "Stopped",
      idle: "Idle"
    })[state] || "Unknown";
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
    return stateName(chat.state);
  }

  function isRecent(chat, now) {
    if (chat.hidden) return false;
    if (chat.pinned) return true;
    if (chat.state === "working" || chat.state === "retry" || chat.state === "attention" || chat.state === "error") return true;
    if (chat.state === "finished") return true;
    if (chat.state === "interrupted") {
      return now - (chat.finishedAt || chat.updatedAt || 0) < RECENT_TTL_MS;
    }
    return settings.monitorShowIdle === true;
  }

  function sendMessage(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  function activateChat(tabId) {
    sendMessage({
      type: "monitor-activate-tab",
      tabId: Number(tabId)
    });
  }

  function setChatPreference(chatKey, patch) {
    return sendMessage({
      type: "monitor-set-chat-pref",
      chatKey,
      patch
    });
  }

  function visibleGroupFor(chat) {
    const now = Date.now();
    return chats.filter((item) =>
      !item.hidden &&
      item.pinned === chat.pinned &&
      isRecent(item, now)
    );
  }

  function persistGroupOrder(group) {
    return sendMessage({
      type: "monitor-set-chat-order",
      chatKeys: group.map((item) => item.chatKey)
    });
  }

  function moveChat(chat, direction) {
    const group = visibleGroupFor(chat);
    const index = group.findIndex((item) => item.chatKey === chat.chatKey);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= group.length) return Promise.resolve(null);

    const reordered = [...group];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    return persistGroupOrder(reordered);
  }

  function clearDropMarkers() {
    dropTarget = null;
    for (const node of rowNodes.values()) {
      node.row.classList.remove("drop-before", "drop-after", "drag-source");
    }
  }

  function reorderDraggedChat(targetChat, before) {
    const draggedChat = chats.find((item) => item.chatKey === draggedChatKey);
    if (!draggedChat || !targetChat || draggedChat.pinned !== targetChat.pinned) return Promise.resolve(null);

    const group = visibleGroupFor(draggedChat);
    const draggedIndex = group.findIndex((item) => item.chatKey === draggedChat.chatKey);
    if (draggedIndex < 0) return Promise.resolve(null);

    const reordered = [...group];
    const [moved] = reordered.splice(draggedIndex, 1);
    let targetIndex = reordered.findIndex((item) => item.chatKey === targetChat.chatKey);
    if (targetIndex < 0) return Promise.resolve(null);
    if (!before) targetIndex += 1;
    reordered.splice(targetIndex, 0, moved);

    return persistGroupOrder(reordered);
  }

  function closeMenus() {
    openMenuTabId = null;
    if (floatingMenu) floatingMenu.hidden = true;
  }

  function createMenuButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-action";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      action();
    });
    return button;
  }

  function createRow(tabId) {
    const row = document.createElement("div");
    row.className = "chat-row";
    row.dataset.tabId = String(tabId);

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⋮⋮";
    handle.draggable = true;
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-label", "Drag to reorder");

    const main = document.createElement("button");
    main.type = "button";
    main.className = "chat-main";

    const dot = document.createElement("span");
    dot.className = "dot";

    const copy = document.createElement("span");
    copy.className = "copy";

    const title = document.createElement("span");
    title.className = "chat-title";

    const meta = document.createElement("span");
    meta.className = "meta";

    copy.append(title, meta);
    main.append(dot, copy);

    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.textContent = "...";
    more.title = "Chat options";

    row.append(handle, main, more);

    const node = {
      row,
      handle,
      main,
      dot,
      title,
      meta,
      more,
      chat: null
    };

    handle.addEventListener("dragstart", (event) => {
      if (!node.chat) {
        event.preventDefault();
        return;
      }

      draggedChatKey = node.chat.chatKey;
      draggedPinned = node.chat.pinned;
      row.classList.add("drag-source");
      closeMenus();

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedChatKey);
      }
    });

    handle.addEventListener("dragend", () => {
      draggedChatKey = null;
      draggedPinned = null;
      clearDropMarkers();
    });

    main.addEventListener("click", () => activateChat(tabId));
    main.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      more.click();
    });

    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = openMenuTabId !== tabId;
      closeMenus();
      if (willOpen && node.chat) {
        openMenuTabId = tabId;
        openFloatingMenu(more, node.chat);
      }
    });

    rowNodes.set(tabId, node);
    return node;
  }

  function rebuildFloatingMenu(chat) {
    if (!floatingMenu) return;
    floatingMenu.replaceChildren();

    floatingMenu.append(
      createMenuButton(chat.alias ? "Rename alias" : "Set alias", () => {
        const result = window.prompt(
          "Name shown only in ChatGPT Monitor:",
          chat.alias || chat.title || ""
        );
        if (result === null) return;
        setChatPreference(chat.chatKey, { alias: result.trim() }).then(closeMenus);
      }),
      createMenuButton(chat.pinned ? "Unpin" : "Pin", () => {
        setChatPreference(chat.chatKey, { pinned: !chat.pinned }).then(closeMenus);
      })
    );

    if (chat.alias) {
      floatingMenu.append(
        createMenuButton("Clear alias", () => {
          setChatPreference(chat.chatKey, { alias: "" }).then(closeMenus);
        })
      );
    }

    floatingMenu.append(
      createMenuButton("Move up", () => {
        moveChat(chat, -1).then(closeMenus);
      }),
      createMenuButton("Move down", () => {
        moveChat(chat, 1).then(closeMenus);
      }),
      createMenuButton("Hide", () => {
        setChatPreference(chat.chatKey, { hidden: true }).then(closeMenus);
      })
    );
  }

  function openFloatingMenu(anchor, chat) {
    if (!floatingMenu) return;
    rebuildFloatingMenu(chat);
    floatingMenu.hidden = false;
    floatingMenu.style.visibility = "hidden";

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = floatingMenu.getBoundingClientRect();
    let left = anchorRect.right - menuRect.width;
    let top = anchorRect.bottom + 5;

    if (left < 8) left = 8;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }
    if (top + menuRect.height > window.innerHeight - 8) {
      top = anchorRect.top - menuRect.height - 5;
    }
    if (top < 8) top = 8;

    floatingMenu.style.left = Math.round(left) + "px";
    floatingMenu.style.top = Math.round(top) + "px";
    floatingMenu.style.visibility = "visible";
  }

  function updateHeaderSummary(visible) {
    const working = chats.filter((chat) => !chat.hidden && chat.state === "working").length;
    const attention = chats.filter((chat) =>
      !chat.hidden && (chat.state === "retry" || chat.state === "attention" || chat.state === "error")
    ).length;
    const done = visible.filter((chat) => chat.state === "finished").length;

    badge.textContent = attention > 0 ? "!" : String(working || 0);
    badge.classList.toggle("attention", attention > 0);
    badge.classList.toggle("active", attention === 0 && working > 0);
    summary.textContent = "W " + working + "  D " + done + "  ! " + attention;
  }

  function maybeFlash(node, chat) {
    const previous = renderedStates.get(chat.tabId);
    renderedStates.set(chat.tabId, chat.state);
    if (!previous || previous === chat.state || settings.monitorAnimations === false) return;
    node.row.classList.remove("flash");
    void node.row.offsetWidth;
    node.row.classList.add("flash");
    setTimeout(() => node.row.classList.remove("flash"), 1200);
  }

  function render() {
    if (!panel || !host) return;

    host.style.display = settings.monitorEnabled === false ? "none" : "block";
    if (settings.monitorEnabled === false) return;

    panel.classList.toggle("collapsed", settings.monitorCollapsed === true);
    panel.classList.toggle("compact", settings.monitorCompact === true);
    panel.classList.toggle("no-animations", settings.monitorAnimations === false);
    collapseButton.textContent = settings.monitorCollapsed ? "+" : "-";
    collapseButton.title = settings.monitorCollapsed ? "Expand monitor" : "Collapse monitor";

    const now = Date.now();
    const visible = chats.filter((chat) => isRecent(chat, now));
    updateHeaderSummary(visible);

    const visibleIds = new Set(visible.map((chat) => chat.tabId));

    for (const [tabId, node] of rowNodes) {
      if (!visibleIds.has(tabId)) {
        node.row.remove();
        rowNodes.delete(tabId);
        renderedStates.delete(tabId);
      }
    }

    for (const chat of visible) {
      const node = rowNodes.get(chat.tabId) || createRow(chat.tabId);
      node.chat = chat;
      node.row.className = "chat-row state-" + chat.state;
      if (chat.url === location.href) node.row.classList.add("current");
      if (chat.pinned) node.row.classList.add("pinned");

      node.title.textContent = (chat.pinned ? "📌 " : "") + (chat.displayTitle || chat.title || "ChatGPT");
      node.meta.textContent = statusText(chat, now);
      node.dot.title = stateName(chat.state);
      node.dot.setAttribute("aria-label", stateName(chat.state));
      node.main.setAttribute(
        "aria-label",
        (chat.displayTitle || chat.title || "ChatGPT") + ", " + node.meta.textContent
      );

      maybeFlash(node, chat);
      list.appendChild(node.row);
    }

    empty.hidden = visible.length > 0;
  }

  function updateTimeLabels() {
    if (document.hidden || !panel || settings.monitorEnabled === false) return;
    const now = Date.now();
    for (const node of rowNodes.values()) {
      if (!node.chat) continue;
      const next = statusText(node.chat, now);
      if (node.meta.textContent !== next) node.meta.textContent = next;
    }
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
      const pos = clampPosition(
        event.clientX - dragging.dx,
        event.clientY - dragging.dy
      );
      panel.style.left = pos.x + "px";
      panel.style.top = pos.y + "px";
    });

    header.addEventListener("pointerup", (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      dragging = null;
      panel.classList.remove("dragging");
      const rect = panel.getBoundingClientRect();
      chrome.storage.local.set({
        monitorPosition: {
          x: Math.round(rect.left),
          y: Math.round(rect.top)
        }
      });
    });
  }

  function buildOverlay() {
    if (host) return;

    host = document.createElement("div");
    host.id = "chatgpt-multichat-monitor-host";
    host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");

    style.textContent =
      ":host{all:initial}*{box-sizing:border-box}" +
      "#panel{position:fixed;width:318px;max-height:min(480px,70vh);overflow:visible;pointer-events:auto;" +
      "font:13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;color:#f5f7fa;background:#12171f;" +
      "border:1px solid #303846;border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.34)}" +
      "#panel.dragging{user-select:none;box-shadow:0 20px 54px rgba(0,0,0,.42)}" +
      ".head{height:46px;display:flex;align-items:center;gap:8px;padding:0 9px 0 12px;cursor:grab;" +
      "border-bottom:1px solid #29313d}.head:active{cursor:grabbing}" +
      ".brand{font-weight:750;letter-spacing:-.01em;flex:1}.summary{color:#7f8b9b;font-size:10px;white-space:pre}" +
      ".badge{min-width:22px;height:22px;padding:0 6px;display:grid;place-items:center;border-radius:999px;" +
      "background:#303846;color:#aeb8c7;font-size:11px;font-weight:800}" +
      ".badge.active{background:#194d47;color:#73f0df}.badge.attention{background:#56351d;color:#ffc984}" +
      ".collapse{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#aeb8c7;" +
      "font-size:18px;line-height:1;cursor:pointer}.collapse:hover{background:#202731;color:white}" +
      ".list{max-height:min(360px,58vh);overflow:auto;padding:7px}" +
      ".chat-row{position:relative;display:flex;align-items:center;gap:3px;border-radius:10px;background:transparent}" +
      ".chat-row:hover,.chat-row.current{background:#1a202a}.chat-row.drag-source{opacity:.42}" +
      ".chat-row.drop-before::before,.chat-row.drop-after::after{content:'';position:absolute;left:7px;right:7px;height:2px;border-radius:999px;background:#63e6d7}" +
      ".chat-row.drop-before::before{top:-1px}.chat-row.drop-after::after{bottom:-1px}" +
      ".drag-handle{width:17px;align-self:stretch;display:grid;place-items:center;color:#526071;font:700 11px/1 system-ui;cursor:grab;user-select:none;opacity:.42}" +
      ".chat-row:hover .drag-handle{opacity:.9;color:#8e9bad}.drag-handle:active{cursor:grabbing}" +
      ".chat-main{min-width:0;flex:1;display:flex;align-items:center;" +
      "gap:10px;border:0;border-radius:10px;padding:9px 7px 9px 10px;background:transparent;color:inherit;text-align:left;cursor:pointer}" +
      ".more{width:27px;height:27px;margin-right:5px;border:0;border-radius:7px;background:transparent;color:#7f8b9b;" +
      "font-weight:800;cursor:pointer}.more:hover{background:#28303b;color:white}" +
      ".dot{width:9px;height:9px;border-radius:50%;background:#687386;flex:0 0 auto}" +
      ".state-working .dot{background:#63e6d7;box-shadow:0 0 0 3px rgba(99,230,215,.09);animation:workingpulse 1.35s ease-in-out infinite}" +
      ".state-finished .dot{background:#72d99b}.state-interrupted .dot{background:#f2bd68}" +
      ".state-retry .dot{background:#ffd65a;box-shadow:0 0 0 3px rgba(255,214,90,.08)}" +
      ".state-attention .dot{background:#ff914d;box-shadow:0 0 0 3px rgba(255,145,77,.08)}" +
      ".state-error .dot{background:#ee7070}" +
      ".copy{min-width:0;display:flex;flex-direction:column;gap:1px;flex:1}" +
      ".chat-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}" +
      ".meta{color:#8e9bad;font-size:11px}.pinned .chat-title{color:#fff}" +
      ".floating-menu{position:fixed;z-index:2147483647;width:144px;padding:5px;border:1px solid #384250;" +
      "border-radius:9px;background:#171d26;box-shadow:0 10px 26px rgba(0,0,0,.4);pointer-events:auto}" +
      ".menu-action{display:block;width:100%;border:0;border-radius:6px;padding:7px 8px;background:transparent;" +
      "color:#d9e0e8;text-align:left;font:12px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer}" +
      ".menu-action:hover{background:#252d38}" +
      ".empty{padding:18px 14px 20px;color:#8e9bad;text-align:center;font-size:12px}" +
      ".foot{padding:8px 12px 10px;color:#6f7c8e;text-align:center;font-size:10px;border-top:1px solid #29313d}" +
      "#panel.collapsed{width:215px}.collapsed .list,.collapsed .empty,.collapsed .foot,.collapsed .summary{display:none}" +
      ".collapsed .head{border-bottom:0}#panel.compact{width:214px}#panel.compact.collapsed{width:174px}" +
      ".compact .head{height:36px;padding:0 6px 0 9px}.compact .brand{font-size:0}.compact .brand::after{content:'Monitor';font-size:11px}" +
      ".compact .summary,.compact .meta,.compact .foot{display:none}" +
      ".compact .list{padding:3px}.compact .chat-main{padding:5px 4px 5px 3px;gap:7px}" +
      ".compact .drag-handle{width:12px;font-size:9px;opacity:.2}.compact .chat-row:hover .drag-handle{opacity:.8}" +
      ".compact .more{width:22px;height:22px;margin-right:2px;opacity:.18;transition:opacity .12s}.compact .chat-row:hover .more,.compact .more:focus-visible{opacity:1}" +
      ".compact .dot{width:8px;height:8px}" +
      ".flash{animation:stateflash 1.2s ease-out 1}.no-animations .state-working .dot,.no-animations .flash{animation:none}" +
      "@keyframes workingpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.52;transform:scale(.82)}}" +
      "@keyframes stateflash{0%{background:#2b3440}100%{background:transparent}}";

    panel = document.createElement("section");
    panel.id = "panel";

    header = document.createElement("div");
    header.className = "head";

    const brand = document.createElement("div");
    brand.className = "brand";
    brand.textContent = "ChatGPT Monitor";

    summary = document.createElement("div");
    summary.className = "summary";

    badge = document.createElement("div");
    badge.className = "badge";

    collapseButton = document.createElement("button");
    collapseButton.className = "collapse";
    collapseButton.type = "button";

    header.append(brand, summary, badge, collapseButton);

    list = document.createElement("div");
    list.className = "list";

    empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No active chats";

    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "Click to switch · drag ⋮⋮ to reorder";

    panel.append(header, list, empty, foot);

    floatingMenu = document.createElement("div");
    floatingMenu.className = "floating-menu";
    floatingMenu.hidden = true;

    shadow.append(style, panel, floatingMenu);
    document.documentElement.appendChild(host);

    collapseButton.addEventListener("click", () => {
      settings.monitorCollapsed = !settings.monitorCollapsed;
      chrome.storage.local.set({
        monitorCollapsed: settings.monitorCollapsed
      });
      render();
    });

    shadow.addEventListener("click", (event) => {
      if (!event.target.closest(".more") && !event.target.closest(".floating-menu")) {
        closeMenus();
      }
    });

    setupDrag();

    list.addEventListener("dragover", (event) => {
      if (!draggedChatKey) return;
      const targetRow = event.target instanceof Element
        ? event.target.closest(".chat-row")
        : null;
      if (!targetRow) return;

      const targetNode = rowNodes.get(Number(targetRow.dataset.tabId));
      if (!targetNode?.chat ||
          targetNode.chat.chatKey === draggedChatKey ||
          targetNode.chat.pinned !== draggedPinned) {
        clearDropMarkers();
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      for (const node of rowNodes.values()) {
        node.row.classList.remove("drop-before", "drop-after");
      }

      const rect = targetRow.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      targetRow.classList.add(before ? "drop-before" : "drop-after");
      dropTarget = {
        chat: targetNode.chat,
        before
      };
    });

    list.addEventListener("drop", (event) => {
      if (!draggedChatKey || !dropTarget) return;
      event.preventDefault();
      const target = dropTarget;
      reorderDraggedChat(target.chat, target.before).finally(() => {
        draggedChatKey = null;
        draggedPinned = null;
        clearDropMarkers();
      });
    });

    list.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !list.contains(event.relatedTarget)) {
        clearDropMarkers();
      }
    });

    list.addEventListener("scroll", closeMenus, { passive: true });
    document.addEventListener("pointerdown", (event) => {
      if (event.target !== host) closeMenus();
    }, true);
    applyPosition(settings.monitorPosition);
    render();
  }

  async function loadSettings() {
    try {
      settings = {
        ...DEFAULTS,
        ...(await chrome.storage.local.get(DEFAULTS))
      };
    } catch {
      settings = { ...DEFAULTS };
    }
  }

  async function requestSnapshot() {
    const response = await sendMessage({ type: "monitor-get-snapshot" });
    if (response && Array.isArray(response.chats)) {
      chats = response.chats;
      render();
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("button")
      : null;

    if (isStopButton(target)) {
      manualStopUntil = Date.now() + 5000;
    }
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

    if (message?.type === "monitor-acknowledge-done") {
      if (localState.state === "finished") {
        setState("idle");
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "monitor-toggle-overlay") {
      settings.monitorEnabled = !settings.monitorEnabled;
      chrome.storage.local.set({
        monitorEnabled: settings.monitorEnabled
      });
      render();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }

    if (changes.monitorPosition) {
      applyPosition(settings.monitorPosition);
    }

    render();
  });

  const observer = new MutationObserver(() => {
    scheduleEvaluate();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "data-testid", "disabled", "role"]
  });

  window.addEventListener("resize", () => {
    closeMenus();
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    applyPosition({ x: rect.left, y: rect.top });
  });

  window.addEventListener("popstate", scheduleEvaluate);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      updateTimeLabels();
      scheduleEvaluate();
    }
  });

  setInterval(() => {
    evaluate({ allowFallback: true });
  }, FALLBACK_SCAN_MS);

  setInterval(() => {
    if (!document.hidden) updateTimeLabels();
  }, 1000);

  setInterval(() => {
    sendCurrentState();
  }, HEARTBEAT_MS);

  (async () => {
    await loadSettings();
    buildOverlay();
    evaluate({ allowFallback: true });
    sendCurrentState();
    await requestSnapshot();
  })();
})();
