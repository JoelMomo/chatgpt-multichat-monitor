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
    monitorOpacity: 1,
    monitorTheme: "dark",
    monitorPosition: null,
    monitorSize: null
  };

  let localState = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    updatedAt: Date.now()
  };

  let settings = { ...DEFAULTS };
  let chats = [];
  let separators = [];
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
  let summary = null;
  let countBadges = null;
  let addSeparatorButton = null;
  let collapseButton = null;
  let resizeHandle = null;
  let autoSizeButton = null;
  let dragging = null;
  let resizing = null;
  let openMenuTabId = null;
  let floatingMenu = null;
  let draggedChatKey = null;
  let draggedSeparatorId = null;
  let dropTarget = null;

  const rowNodes = new Map();
  const separatorNodes = new Map();
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

  function promptHasDraft() {
    const selectors = [
      "#prompt-textarea",
      '[data-testid="composer-text-input"]',
      'textarea[data-testid="prompt-textarea"]',
      "form textarea",
      'form [contenteditable="true"]'
    ];

    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element) || !isVisible(element)) continue;
        seen.add(element);

        const raw = "value" in element
          ? element.value
          : (element.innerText || element.textContent || "");
        const text = String(raw || "")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .trim();

        if (text) return true;
      }
    }

    return false;
  }

  function setRestingState() {
    setState(promptHasDraft() ? "draft" : "idle", {
      startedAt: null,
      finishedAt: null
    });
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
      setRestingState();
      return;
    }

    resetTimer = setTimeout(() => {
      if (localState.state === state) setRestingState();
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

    if (state === "idle" || state === "draft") {
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
      localState.state !== "draft" &&
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

    if (localState.state === "idle" || localState.state === "draft") {
      const nextRestingState = promptHasDraft() ? "draft" : "idle";
      if (localState.state !== nextRestingState) {
        setState(nextRestingState, {
          startedAt: null,
          finishedAt: null
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
      draft: "Draft",
      pending: "Pending",
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
    if (chat.state === "working" || chat.state === "retry" || chat.state === "attention" || chat.state === "error" || chat.state === "draft" || chat.state === "pending") return true;
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

  function layoutTokenForElement(element) {
    if (!(element instanceof Element)) return "";
    if (element.dataset.separatorId) return "s:" + element.dataset.separatorId;
    if (element.dataset.chatKey) return "c:" + element.dataset.chatKey;
    return "";
  }

  function currentLayoutTokens() {
    return [...list.children]
      .map(layoutTokenForElement)
      .filter(Boolean);
  }

  function persistLayoutMove(draggedToken, targetToken, before) {
    const tokens = currentLayoutTokens().filter((token) => token !== draggedToken);
    let targetIndex = tokens.indexOf(targetToken);
    if (targetIndex < 0) return Promise.resolve(null);
    if (!before) targetIndex += 1;
    tokens.splice(targetIndex, 0, draggedToken);
    return sendMessage({ type: "monitor-set-layout", tokens });
  }

  function visibleGroupFor(chat) {
    const now = Date.now();
    return chats.filter((item) =>
      !item.hidden &&
      item.pinned === chat.pinned &&
      (!separators.length || (item.section === chat.section && item.state === chat.state)) &&
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
    for (const node of separatorNodes.values()) {
      node.row.classList.remove("drop-before", "drop-after", "drag-source");
    }
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

  function createSeparatorRow(id) {
    const row = document.createElement("div");
    row.className = "section-separator";
    row.dataset.separatorId = id;

    const handle = document.createElement("span");
    handle.className = "separator-handle";
    handle.draggable = true;
    handle.textContent = "⋮⋮";
    handle.title = "Drag separator";
    handle.setAttribute("aria-label", "Drag separator");

    const line = document.createElement("span");
    line.className = "separator-line";
    line.setAttribute("aria-hidden", "true");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "separator-remove";
    remove.textContent = "×";
    remove.title = "Remove separator";
    remove.setAttribute("aria-label", "Remove separator");

    row.append(handle, line, remove);

    handle.addEventListener("dragstart", (event) => {
      draggedSeparatorId = id;
      draggedChatKey = null;
      row.classList.add("drag-source");
      closeMenus();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "s:" + id);
      }
    });

    handle.addEventListener("dragend", () => {
      draggedSeparatorId = null;
      clearDropMarkers();
    });

    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      sendMessage({ type: "monitor-remove-separator", id });
    });

    const node = { row, handle, line, remove };
    separatorNodes.set(id, node);
    return node;
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
      draggedSeparatorId = null;
      row.classList.add("drag-source");
      closeMenus();

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedChatKey);
      }
    });

    handle.addEventListener("dragend", () => {
      draggedChatKey = null;
      clearDropMarkers();
    });

    dot.addEventListener("contextmenu", (event) => {
      if (!node.chat || !["idle", "pending"].includes(node.chat.state)) return;
      event.preventDefault();
      event.stopPropagation();
      setChatPreference(node.chat.chatKey, {
        pending: node.chat.state !== "pending"
      });
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
    const pending = chats.filter((chat) => !chat.hidden && chat.state === "pending").length;
    const done = visible.filter((chat) => chat.state === "finished").length;

    const counts = {
      working,
      done,
      attention,
      pending
    };

    let visibleCount = 0;
    for (const [state, element] of Object.entries(countBadges)) {
      const value = counts[state] || 0;
      element.textContent = String(value);
      element.hidden = value === 0;
      if (value > 0) visibleCount += 1;
      element.setAttribute("aria-label", element.dataset.label + ": " + value);
      element.title = element.dataset.label + ": " + value;
    }

    summary.hidden = visibleCount === 0;
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

  function resolvedTheme(value = settings.monitorTheme) {
    if (value === "light" || value === "dark") return value;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function normalizedOpacity(value = settings.monitorOpacity) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(0.35, Math.min(1, numeric));
  }

  function normalizedPanelSize(size) {
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
    const maxWidth = Math.max(250, Math.min(560, window.innerWidth - 16));
    const maxHeight = Math.max(150, Math.min(640, Math.floor(window.innerHeight * 0.78)));
    return {
      width: Math.max(250, Math.min(size.width, maxWidth)),
      height: Math.max(150, Math.min(size.height, maxHeight))
    };
  }

  function applyAppearance() {
    if (!host || !panel) return;
    const theme = resolvedTheme();
    host.dataset.theme = theme;
    const opacity = normalizedOpacity();
    panel.style.opacity = String(opacity);
    if (floatingMenu) floatingMenu.style.opacity = String(opacity);
  }

  function applyPanelSize(size = settings.monitorSize) {
    if (!panel) return;
    const manualSize = normalizedPanelSize(size);
    const canResize = settings.monitorCollapsed !== true && settings.monitorCompact !== true;

    panel.classList.toggle("manual-size", canResize && !!manualSize);
    panel.classList.toggle("auto-fit", canResize && !manualSize);
    if (resizeHandle) resizeHandle.hidden = !canResize;
    if (autoSizeButton) {
      autoSizeButton.disabled = !canResize || !manualSize;
      autoSizeButton.title = manualSize
        ? "Fit monitor to the visible chats"
        : "Monitor already follows the visible chats";
    }

    if (!canResize || !manualSize) {
      panel.style.removeProperty("width");
      panel.style.removeProperty("height");
      return;
    }

    panel.style.width = Math.round(manualSize.width) + "px";
    panel.style.height = Math.round(manualSize.height) + "px";
  }

  function render() {
    if (!panel || !host) return;

    host.style.display = settings.monitorEnabled === false ? "none" : "block";
    if (settings.monitorEnabled === false) return;

    panel.classList.toggle("collapsed", settings.monitorCollapsed === true);
    panel.classList.toggle("compact", settings.monitorCompact === true);
    panel.classList.toggle("no-animations", settings.monitorAnimations === false);
    applyPanelSize();
    applyAppearance();
    collapseButton.textContent = settings.monitorCollapsed ? "+" : "-";
    collapseButton.title = settings.monitorCollapsed ? "Expand monitor" : "Collapse monitor";

    const now = Date.now();
    const visible = chats.filter((chat) => isRecent(chat, now));
    const hasContent = visible.length > 0 || separators.length > 0;
    panel.classList.toggle("is-empty", !hasContent);
    updateHeaderSummary(visible);

    const visibleIds = new Set(visible.map((chat) => chat.tabId));
    const separatorIds = new Set(separators.map((separator) => separator.id));

    for (const [tabId, node] of rowNodes) {
      if (!visibleIds.has(tabId)) {
        node.row.remove();
        rowNodes.delete(tabId);
        renderedStates.delete(tabId);
      }
    }
    for (const [id, node] of separatorNodes) {
      if (!separatorIds.has(id)) {
        node.row.remove();
        separatorNodes.delete(id);
      }
    }

    const groups = new Map([["", []]]);
    for (const separator of separators) groups.set(separator.id, []);
    for (const chat of visible) {
      const section = groups.has(chat.section) ? chat.section : "";
      groups.get(section).push(chat);
    }

    const appendChat = (chat) => {
      const node = rowNodes.get(chat.tabId) || createRow(chat.tabId);
      node.chat = chat;
      node.row.dataset.chatKey = chat.chatKey;
      node.row.className = "chat-row state-" + chat.state;
      if (chat.url === location.href) node.row.classList.add("current");
      if (chat.pinned) node.row.classList.add("pinned");

      node.title.textContent = (chat.pinned ? "📌 " : "") + (chat.displayTitle || chat.title || "ChatGPT");
      node.meta.textContent = statusText(chat, now);
      node.dot.title = chat.state === "idle"
        ? "Idle — right-click to mark Pending"
        : chat.state === "pending"
          ? "Pending — right-click to clear"
          : stateName(chat.state);
      node.dot.setAttribute("aria-label", stateName(chat.state));
      node.main.setAttribute(
        "aria-label",
        (chat.displayTitle || chat.title || "ChatGPT") + ", " + node.meta.textContent
      );

      maybeFlash(node, chat);
      list.appendChild(node.row);
    };

    for (const chat of groups.get("")) appendChat(chat);
    for (const separator of separators) {
      const node = separatorNodes.get(separator.id) || createSeparatorRow(separator.id);
      node.row.className = "section-separator";
      list.appendChild(node.row);
      for (const chat of groups.get(separator.id)) appendChat(chat);
    }

    empty.hidden = hasContent;
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

  function setupResize() {
    if (!resizeHandle) return;

    const updateResize = (event) => {
      if (!resizing) return;

      const maxWidth = Math.max(250, Math.min(560, window.innerWidth - resizing.left - 8));
      const maxHeight = Math.max(150, Math.min(640, window.innerHeight - resizing.top - 8));
      const next = {
        width: Math.max(250, Math.min(resizing.startWidth + event.clientX - resizing.startX, maxWidth)),
        height: Math.max(150, Math.min(resizing.startHeight + event.clientY - resizing.startY, maxHeight))
      };

      settings.monitorSize = next;
      panel.classList.add("manual-size");
      panel.style.width = Math.round(next.width) + "px";
      panel.style.height = Math.round(next.height) + "px";
      event.preventDefault();
    };

    const finishResize = () => {
      if (!resizing) return;
      resizing = null;
      panel.classList.remove("resizing");
      host.style.pointerEvents = "none";
      host.style.cursor = "";

      const rect = panel.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      settings.monitorSize = next;
      chrome.storage.local.set({ monitorSize: next });
    };

    resizeHandle.addEventListener("mousedown", (event) => {
      if (event.button !== 0 ||
          settings.monitorCollapsed === true ||
          settings.monitorCompact === true) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      resizing = {
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        left: rect.left,
        top: rect.top
      };

      host.style.pointerEvents = "auto";
      host.style.cursor = "nwse-resize";
      panel.classList.add("resizing");
      closeMenus();
      event.preventDefault();
      event.stopPropagation();
    });

    host.addEventListener("mousemove", updateResize, true);
    host.addEventListener("mouseup", finishResize, true);
    document.addEventListener("mouseleave", finishResize, true);
    window.addEventListener("blur", finishResize);
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
      "#panel{position:fixed;display:flex;flex-direction:column;width:318px;max-height:min(480px,70vh);overflow:visible;pointer-events:auto;" +
      "font:13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;color:#f5f7fa;background:#12171f;" +
      "border:1px solid #303846;border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.34)}" +
      "#panel.dragging,#panel.resizing{user-select:none;box-shadow:0 20px 54px rgba(0,0,0,.42)}" +
      ".head{height:46px;display:flex;align-items:center;gap:8px;padding:0 9px 0 12px;cursor:grab;" +
      "border-bottom:1px solid #29313d}.head:active{cursor:grabbing}" +
      ".brand{font-weight:750;letter-spacing:-.01em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.summary{display:flex;align-items:center;gap:5px;white-space:nowrap}" +
      ".summary[hidden]{display:none}.count-badge{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;font-size:10px;font-weight:850;font-variant-numeric:tabular-nums;line-height:1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}" +
      ".count-badge[hidden]{display:none}.count-working{background:rgba(99,230,215,.13);color:#63e6d7}.count-done{background:rgba(167,243,107,.13);color:#a7f36b}.count-attention{background:rgba(240,163,90,.14);color:#f0a35a}.count-pending{background:rgba(244,114,182,.13);color:#f472b6}" +
      ".add-separator{position:relative;width:28px;height:28px;flex:0 0 auto;border:0;border-radius:8px;background:transparent;color:#7f8b9b;cursor:pointer}.add-separator:hover{background:#202731;color:#d9e0e8}" +
      ".add-separator::before{content:'';position:absolute;left:6px;right:6px;top:10px;height:1px;background:currentColor;box-shadow:0 6px 0 currentColor}.add-separator::after{content:'+';position:absolute;right:2px;bottom:1px;width:11px;height:11px;display:grid;place-items:center;border-radius:50%;background:#12171f;color:currentColor;font:800 10px/1 system-ui}" +
      ".collapse{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#aeb8c7;" +
      "font-size:18px;line-height:1;cursor:pointer}.collapse:hover{background:#202731;color:white}" +
      ".list{max-height:min(360px,58vh);min-height:0;overflow:auto;padding:7px}.manual-size{max-height:none}.manual-size .list{max-height:none;flex:1}.manual-size.is-empty .list{display:none}.manual-size.is-empty .empty{margin:auto 0}" +
      ".chat-row{position:relative;display:flex;align-items:center;gap:3px;border-radius:10px;background:transparent}" +
      ".chat-row:hover,.chat-row.current{background:#1a202a}.chat-row.drag-source,.section-separator.drag-source{opacity:.42}" +
      ".chat-row.drop-before::before,.chat-row.drop-after::after,.section-separator.drop-before::before,.section-separator.drop-after::after{content:'';position:absolute;left:7px;right:7px;height:2px;border-radius:999px;background:#63e6d7}" +
      ".chat-row.drop-before::before,.section-separator.drop-before::before{top:-1px}.chat-row.drop-after::after,.section-separator.drop-after::after{bottom:-1px}" +
      ".section-separator{position:relative;height:22px;display:flex;align-items:center;gap:6px;padding:0 5px 0 0}.separator-handle{width:17px;align-self:stretch;display:grid;place-items:center;color:#526071;font:700 10px/1 system-ui;cursor:grab;user-select:none;opacity:.38}.section-separator:hover .separator-handle{opacity:.9;color:#8e9bad}.separator-handle:active{cursor:grabbing}.separator-line{height:1px;flex:1;background:#303846}.separator-remove{width:20px;height:20px;border:0;border-radius:6px;background:transparent;color:#687386;font:500 15px/1 system-ui;cursor:pointer;opacity:0}.section-separator:hover .separator-remove,.separator-remove:focus-visible{opacity:.8}.separator-remove:hover{background:#252d38;color:#d9e0e8}" +
      ".drag-handle{width:17px;align-self:stretch;display:grid;place-items:center;color:#526071;font:700 11px/1 system-ui;cursor:grab;user-select:none;opacity:.42}" +
      ".chat-row:hover .drag-handle{opacity:.9;color:#8e9bad}.drag-handle:active{cursor:grabbing}" +
      ".chat-main{min-width:0;flex:1;display:flex;align-items:center;" +
      "gap:10px;border:0;border-radius:10px;padding:9px 7px 9px 10px;background:transparent;color:inherit;text-align:left;cursor:pointer}" +
      ".more{width:27px;height:27px;margin-right:5px;border:0;border-radius:7px;background:transparent;color:#7f8b9b;" +
      "font-weight:800;cursor:pointer}.more:hover{background:#28303b;color:white}" +
      ".dot{position:relative;width:9px;height:9px;border-radius:50%;background:#687386;flex:0 0 auto}" +
      ".state-idle .dot,.state-pending .dot{cursor:context-menu}.state-idle .dot::after,.state-pending .dot::after{content:'';position:absolute;inset:-8px;border-radius:50%}" +
      ".state-working .dot{background:#63e6d7;box-shadow:0 0 0 3px rgba(99,230,215,.09);animation:workingpulse 1.35s ease-in-out infinite}" +
      ".state-finished .dot{background:#a7f36b;box-shadow:0 0 0 3px rgba(167,243,107,.1),0 0 10px rgba(167,243,107,.24)}.chat-row.state-finished{box-shadow:inset 2px 0 0 rgba(167,243,107,.48)}.state-interrupted .dot{background:#f2bd68}" +
      ".state-retry .dot{background:#ffd65a;box-shadow:0 0 0 3px rgba(255,214,90,.08)}" +
      ".state-attention .dot{background:#ff914d;box-shadow:0 0 0 3px rgba(255,145,77,.08)}" +
      ".state-error .dot{background:#ee7070}.state-draft .dot{background:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.07)}" +
      ".state-pending .dot{background:#f472b6;box-shadow:0 0 0 3px rgba(244,114,182,.08),0 0 9px rgba(244,114,182,.18);animation:pendingpulse 4.5s ease-in-out infinite}" +
      ".copy{min-width:0;display:flex;flex-direction:column;gap:1px;flex:1}" +
      ".chat-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}" +
      ".meta{color:#8e9bad;font-size:11px}.pinned .chat-title{color:#fff}" +
      ".floating-menu{position:fixed;z-index:2147483647;width:144px;padding:5px;border:1px solid #384250;" +
      "border-radius:9px;background:#171d26;box-shadow:0 10px 26px rgba(0,0,0,.4);pointer-events:auto}" +
      ".menu-action{display:block;width:100%;border:0;border-radius:6px;padding:7px 8px;background:transparent;" +
      "color:#d9e0e8;text-align:left;font:12px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer}" +
      ".menu-action:hover{background:#252d38}" +
      ".empty{padding:18px 14px 20px;color:#8e9bad;text-align:center;font-size:12px}" +
      ".foot{min-height:35px;display:flex;align-items:center;justify-content:center;gap:8px;padding:7px 9px 8px 12px;color:#6f7c8e;text-align:center;font-size:10px;border-top:1px solid #29313d}" +
      ".foot-copy{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.auto-size-button{display:inline-flex;align-items:center;flex:0 0 auto;height:22px;padding:0 7px;border:1px solid #354052;border-radius:7px;background:#171d26;color:#aeb8c7;font:600 10px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer}" +
      ".auto-size-button:hover:not(:disabled){background:#252d38;color:#fff;border-color:#465267}.auto-size-button:disabled{opacity:.38;cursor:default}" +
      "#panel.collapsed{width:215px}.collapsed .list,.collapsed .empty,.collapsed .foot,.collapsed .add-separator{display:none}" +
      ".collapsed .head{border-bottom:0;gap:5px}.collapsed .brand{font-size:0}.collapsed .brand::after{content:'Monitor';font-size:11px}.collapsed .summary{gap:3px}.collapsed .count-badge{width:18px;height:18px;font-size:9px}" +
      "#panel.compact{width:214px}#panel.compact.collapsed{width:214px}" +
      ".compact .head{height:36px;padding:0 6px 0 9px;gap:5px}.compact .brand{font-size:0}.compact .brand::after{content:'Monitor';font-size:11px}" +
      ".compact .summary{gap:3px}.compact .count-badge{width:18px;height:18px;font-size:9px}.compact .add-separator{width:24px;height:24px}.compact .add-separator::before{left:5px;right:5px}.compact .meta,.compact .foot{display:none}" +
      ".compact .list{padding:3px}.compact .chat-main{padding:5px 4px 5px 3px;gap:7px}.compact .section-separator{height:18px}.compact .separator-remove{width:18px;height:18px}" +
      ".compact .drag-handle{width:12px;font-size:9px;opacity:.2}.compact .chat-row:hover .drag-handle{opacity:.8}" +
      ".compact .more{width:22px;height:22px;margin-right:2px;opacity:.18;transition:opacity .12s}.compact .chat-row:hover .more,.compact .more:focus-visible{opacity:1}" +
      ".compact .dot{width:8px;height:8px}" +
      ".resize-handle{position:absolute;right:3px;bottom:3px;width:19px;height:19px;border:0;border-radius:0 0 10px 0;cursor:nwse-resize;touch-action:none;opacity:.38;" +
      "background:linear-gradient(135deg,transparent 0 52%,#718095 53% 58%,transparent 59% 68%,#718095 69% 74%,transparent 75%);transition:opacity .12s}" +
      ".resize-handle:hover,.resizing .resize-handle{opacity:.86}.compact .resize-handle,.collapsed .resize-handle{display:none}" +
      ":host([data-theme='light']) #panel{color:#1d2836;background:#f7f9fc;border-color:#d5dde8;box-shadow:0 16px 44px rgba(31,43,58,.2)}" +
      ":host([data-theme='light']) #panel.dragging,:host([data-theme='light']) #panel.resizing{box-shadow:0 20px 54px rgba(31,43,58,.26)}" +
      ":host([data-theme='light']) .head{border-bottom-color:#dce3ec}:host([data-theme='light']) .count-badge{box-shadow:inset 0 0 0 1px rgba(31,43,58,.06)}:host([data-theme='light']) .count-working{background:rgba(35,143,132,.11);color:#238f84}:host([data-theme='light']) .count-done{background:rgba(90,142,38,.11);color:#5a8e26}:host([data-theme='light']) .count-pending{background:rgba(182,59,125,.1);color:#b63b7d}:host([data-theme='light']) .count-attention{background:rgba(164,91,31,.11);color:#a45b1f}" +
      ":host([data-theme='light']) .add-separator{color:#6c798b}:host([data-theme='light']) .add-separator:hover{background:#e8edf3;color:#263342}:host([data-theme='light']) .add-separator::after{background:#f7f9fc}:host([data-theme='light']) .collapse{color:#647286}:host([data-theme='light']) .collapse:hover{background:#e8edf3;color:#182331}" +
      ":host([data-theme='light']) .chat-row:hover,:host([data-theme='light']) .chat-row.current{background:#eaf0f6}" +
      ":host([data-theme='light']) .drag-handle,:host([data-theme='light']) .separator-handle{color:#8b97a7}:host([data-theme='light']) .chat-row:hover .drag-handle,:host([data-theme='light']) .section-separator:hover .separator-handle{color:#536174}:host([data-theme='light']) .separator-line{background:#d5dde8}:host([data-theme='light']) .separator-remove{color:#8794a5}:host([data-theme='light']) .separator-remove:hover{background:#e8edf3;color:#263342}" +
      ":host([data-theme='light']) .more{color:#6c798b}:host([data-theme='light']) .more:hover{background:#dfe6ee;color:#182331}" +
      ":host([data-theme='light']) .meta{color:#68778b}:host([data-theme='light']) .pinned .chat-title{color:#17212d}" +
      ":host([data-theme='light']) .floating-menu{border-color:#ced7e2;background:#ffffff;box-shadow:0 10px 26px rgba(31,43,58,.2)}" +
      ":host([data-theme='light']) .menu-action{color:#263342}:host([data-theme='light']) .menu-action:hover{background:#edf2f7}" +
      ":host([data-theme='light']) .empty{color:#748196}:host([data-theme='light']) .foot{color:#7c899b;border-top-color:#dce3ec}" +
      ":host([data-theme='light']) .auto-size-button{border-color:#ccd5df;background:#f8fafc;color:#5c6a7c}:host([data-theme='light']) .auto-size-button:hover{background:#e9eff5;color:#182331;border-color:#b8c4d1}" +
      ":host([data-theme='light']) .resize-handle{background:linear-gradient(135deg,transparent 0 52%,#7d8998 53% 58%,transparent 59% 68%,#7d8998 69% 74%,transparent 75%)}" +
      ".flash{animation:stateflash 1.2s ease-out 1}.no-animations .state-working .dot,.no-animations .state-pending .dot,.no-animations .flash{animation:none}:host([data-theme='light']) .flash{animation-name:stateflashlight}" +
      "@keyframes workingpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.52;transform:scale(.82)}}@keyframes pendingpulse{0%,100%{opacity:1;transform:scale(1);box-shadow:0 0 0 3px rgba(244,114,182,.08),0 0 9px rgba(244,114,182,.18)}50%{opacity:.62;transform:scale(.9);box-shadow:0 0 0 4px rgba(244,114,182,.05),0 0 13px rgba(244,114,182,.12)}}" +
      "@keyframes stateflash{0%{background:#2b3440}100%{background:transparent}}@keyframes stateflashlight{0%{background:#dce7f2}100%{background:transparent}}";

    panel = document.createElement("section");
    panel.id = "panel";

    header = document.createElement("div");
    header.className = "head";

    const brand = document.createElement("div");
    brand.className = "brand";
    brand.textContent = "ChatGPT Monitor";

    summary = document.createElement("div");
    summary.className = "summary";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-label", "Chat status counts");

    countBadges = {};
    for (const [state, label] of [
      ["working", "Working"],
      ["done", "Done"],
      ["pending", "Pending"],
      ["attention", "Needs attention"]
    ]) {
      const count = document.createElement("span");
      count.className = "count-badge count-" + state;
      count.dataset.label = label;
      count.hidden = true;
      summary.append(count);
      countBadges[state] = count;
    }

    addSeparatorButton = document.createElement("button");
    addSeparatorButton.className = "add-separator";
    addSeparatorButton.type = "button";
    addSeparatorButton.title = "Add separator";
    addSeparatorButton.setAttribute("aria-label", "Add separator");

    collapseButton = document.createElement("button");
    collapseButton.className = "collapse";
    collapseButton.type = "button";

    header.append(brand, summary, addSeparatorButton, collapseButton);

    list = document.createElement("div");
    list.className = "list";

    empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No active chats";

    const foot = document.createElement("div");
    foot.className = "foot";

    const footCopy = document.createElement("span");
    footCopy.className = "foot-copy";
    footCopy.textContent = "Click to switch · drag ⋮⋮ to reorder";

    autoSizeButton = document.createElement("button");
    autoSizeButton.className = "auto-size-button";
    autoSizeButton.type = "button";
    autoSizeButton.textContent = "Auto size";
    autoSizeButton.title = "Fit monitor to the visible chats";
    autoSizeButton.setAttribute("aria-label", "Return monitor to automatic size");

    foot.append(footCopy, autoSizeButton);

    resizeHandle = document.createElement("div");
    resizeHandle.className = "resize-handle";
    resizeHandle.title = "Resize monitor";
    resizeHandle.setAttribute("role", "separator");
    resizeHandle.setAttribute("aria-label", "Resize monitor");

    panel.append(header, list, empty, foot, resizeHandle);

    floatingMenu = document.createElement("div");
    floatingMenu.className = "floating-menu";
    floatingMenu.hidden = true;

    shadow.append(style, panel, floatingMenu);
    document.documentElement.appendChild(host);

    addSeparatorButton.addEventListener("click", (event) => {
      event.stopPropagation();
      sendMessage({ type: "monitor-add-separator" });
    });

    collapseButton.addEventListener("click", () => {
      settings.monitorCollapsed = !settings.monitorCollapsed;
      chrome.storage.local.set({
        monitorCollapsed: settings.monitorCollapsed
      });
      render();
    });

    autoSizeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      settings.monitorSize = null;
      chrome.storage.local.set({ monitorSize: null });
      render();
      applyPosition(settings.monitorPosition);
    });

    shadow.addEventListener("click", (event) => {
      if (!event.target.closest(".more") && !event.target.closest(".floating-menu")) {
        closeMenus();
      }
    });

    setupDrag();
    setupResize();

    list.addEventListener("dragover", (event) => {
      const draggedToken = draggedSeparatorId
        ? "s:" + draggedSeparatorId
        : draggedChatKey
          ? "c:" + draggedChatKey
          : "";
      if (!draggedToken) return;

      const targetRow = event.target instanceof Element
        ? event.target.closest(".chat-row, .section-separator")
        : null;
      if (!targetRow) return;
      const targetToken = layoutTokenForElement(targetRow);
      if (!targetToken || targetToken === draggedToken) return;

      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      for (const node of rowNodes.values()) {
        node.row.classList.remove("drop-before", "drop-after");
      }
      for (const node of separatorNodes.values()) {
        node.row.classList.remove("drop-before", "drop-after");
      }

      const rect = targetRow.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      targetRow.classList.add(before ? "drop-before" : "drop-after");
      dropTarget = { token: targetToken, before };
    });

    list.addEventListener("drop", (event) => {
      const draggedToken = draggedSeparatorId
        ? "s:" + draggedSeparatorId
        : draggedChatKey
          ? "c:" + draggedChatKey
          : "";
      if (!draggedToken || !dropTarget) return;
      event.preventDefault();
      const target = dropTarget;
      persistLayoutMove(draggedToken, target.token, target.before).finally(() => {
        draggedChatKey = null;
        draggedSeparatorId = null;
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
    render();
    applyPosition(settings.monitorPosition);
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
      separators = Array.isArray(response.separators) ? response.separators : [];
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
      separators = Array.isArray(message.separators) ? message.separators : [];
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
        setRestingState();
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
      if (changes[key]) {
        settings[key] = changes[key].newValue === undefined
          ? DEFAULTS[key]
          : changes[key].newValue;
      }
    }

    if (changes.monitorPosition) {
      applyPosition(settings.monitorPosition);
    }

    if (changes.monitorSize) {
      applyPanelSize(settings.monitorSize);
      applyPosition(settings.monitorPosition);
    }

    render();
  });

  const observer = new MutationObserver(() => {
    scheduleEvaluate();
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const editorSelector = [
      "#prompt-textarea",
      '[data-testid="composer-text-input"]',
      'textarea[data-testid="prompt-textarea"]',
      "form textarea",
      'form [contenteditable="true"]'
    ].join(",");

    if (target.matches(editorSelector) || target.closest(editorSelector)) {
      scheduleEvaluate();
    }
  }, true);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "data-testid", "disabled", "role"]
  });

  window.addEventListener("resize", () => {
    closeMenus();
    if (!panel) return;
    applyPanelSize(settings.monitorSize);
    const rect = panel.getBoundingClientRect();
    applyPosition({ x: rect.left, y: rect.top });
  });

  const systemThemeMedia = window.matchMedia("(prefers-color-scheme: light)");
  systemThemeMedia.addEventListener("change", () => {
    if (settings.monitorTheme === "system") applyAppearance();
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
