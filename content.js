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
    monitorHoverFocus: false,
    monitorTheme: "dark",
    monitorGroupMode: "project",
    monitorSectionUi: {},
    monitorLayoutLocked: false,
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
  let projectInfo = {
    conversationId: "",
    known: false,
    key: "",
    name: ""
  };
  let projectRefreshTimer = null;
  let host = null;
  let panel = null;
  let header = null;
  let list = null;
  let empty = null;
  let summary = null;
  let countBadges = null;
  let addSeparatorButton = null;
  let lockButton = null;
  let undoButton = null;
  let collapseButton = null;
  let resizeHandle = null;
  let autoSizeButton = null;
  let footCopy = null;
  let dragging = null;
  let resizing = null;
  let openMenuTabId = null;
  let openMenuSectionId = null;
  let floatingMenu = null;
  let undoTimer = null;
  let currentUndoId = "";
  let draggedChatKey = null;
  let draggedSectionToken = null;
  let dropTarget = null;

  const rowNodes = new Map();
  const separatorNodes = new Map();
  const sectionDropNodes = new Map();
  const renderedStates = new Map();

  function isVisible(element) {
    return !!element &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function conversationIdFromHref(href) {
    try {
      const parsed = new URL(href || "", location.origin);
      const match = parsed.pathname.match(/\/c\/([^/?#]+)/);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  function projectRefFromHref(href) {
    try {
      const parsed = new URL(href || "", location.origin);
      const match = parsed.pathname.match(/^\/g\/(g-p-[^/]+)(?:\/|$)/i);
      if (!match) return null;
      const segment = match[1];
      const stable = segment.match(/^(g-p-[0-9a-f]{16,})/i);
      const key = stable ? stable[1] : segment;
      const slug = segment.slice(key.length).replace(/^-+/, "");
      return { key, segment, slug };
    } catch {
      return null;
    }
  }

  function humanizeProjectSlug(slug) {
    if (!slug) return "";
    let value = slug;
    try {
      value = decodeURIComponent(value);
    } catch {}
    value = value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!value) return "";
    return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  function cleanProjectLabel(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function cleanProjectNameCandidate(value) {
    let label = cleanProjectLabel(value);
    if (!label) return "";

    label = label
      .replace(/^(?:abrir\s+(?:el\s+)?proyecto|open\s+project|ouvrir\s+(?:le\s+)?projet|projekt\s+öffnen|apri\s+progetto|abrir\s+projeto)\s*[:\-–—]?\s*/i, "")
      .trim();

    return cleanProjectLabel(label);
  }

  function projectNameFromDom(projectKey) {
    if (!projectKey) return "";
    for (const link of document.querySelectorAll('a[href*="/g/g-p-"]')) {
      const ref = projectRefFromHref(link.getAttribute("href") || link.href);
      if (!ref || ref.key !== projectKey) continue;
      let path = "";
      try {
        path = new URL(link.getAttribute("href") || link.href, location.origin).pathname;
      } catch {}
      if (!/\/project\/?$/i.test(path)) continue;

      for (const candidate of [
        link.textContent,
        link.getAttribute("title"),
        link.getAttribute("aria-label")
      ]) {
        const label = cleanProjectNameCandidate(candidate);
        if (label) return label;
      }
    }
    return "";
  }

  function detectProjectInfo() {
    const conversationId = conversationIdFromHref(location.href);
    let ref = projectRefFromHref(location.href);
    if (!ref) {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) ref = projectRefFromHref(canonical.getAttribute("href") || canonical.href);
    }
    let known = !!ref;

    if (!ref && conversationId) {
      let foundPlainConversationLink = false;
      for (const link of document.querySelectorAll('a[href*="/c/"]')) {
        const href = link.getAttribute("href") || link.href || "";
        if (conversationIdFromHref(href) !== conversationId) continue;
        const linkedProject = projectRefFromHref(href);
        if (linkedProject) {
          ref = linkedProject;
          known = true;
          break;
        }
        foundPlainConversationLink = true;
      }
      if (!ref && foundPlainConversationLink) known = true;
    }

    if (!ref) {
      return {
        conversationId,
        known,
        key: "",
        name: ""
      };
    }

    return {
      conversationId,
      known: true,
      key: ref.key,
      name: projectNameFromDom(ref.key) || humanizeProjectSlug(ref.slug)
    };
  }

  function refreshProjectInfo(notify = false) {
    const detected = detectProjectInfo();
    const sameConversation = detected.conversationId &&
      detected.conversationId === projectInfo.conversationId;
    const next = !detected.known && sameConversation && projectInfo.known
      ? projectInfo
      : detected;
    const before = [projectInfo.conversationId, projectInfo.known, projectInfo.key, projectInfo.name].join("|");
    const after = [next.conversationId, next.known, next.key, next.name].join("|");
    projectInfo = next;
    if (notify && before !== after) sendCurrentState();
    return projectInfo;
  }

  function scheduleProjectRefresh() {
    if (projectRefreshTimer) return;
    projectRefreshTimer = setTimeout(() => {
      projectRefreshTimer = null;
      refreshProjectInfo(true);
    }, MUTATION_THROTTLE_MS);
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
    const project = refreshProjectInfo(false);
    return {
      type: "monitor-state",
      title: document.title,
      url: location.href,
      state: localState.state,
      startedAt: localState.startedAt,
      finishedAt: localState.finishedAt,
      updatedAt: localState.updatedAt,
      projectKnown: project.known === true,
      projectKey: project.key || "",
      projectName: project.name || ""
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
      projectInfo = {
        conversationId: conversationIdFromHref(location.href),
        known: false,
        key: "",
        name: ""
      };
      scheduleProjectRefresh();
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

  function activeGroupMode() {
    return ["project", "manual", "none"].includes(settings.monitorGroupMode)
      ? settings.monitorGroupMode
      : "project";
  }

  function layoutLocked() {
    return settings.monitorLayoutLocked === true;
  }

  function sectionUiState(sectionKey) {
    const all = settings.monitorSectionUi;
    if (!all || typeof all !== "object") return {};
    const value = all[sectionKey];
    return value && typeof value === "object" ? value : {};
  }

  function projectSectionKey(chat) {
    if (chat.projectKey) return "project:" + chat.projectKey;
    return chat.projectKnown === true ? "project:none" : "project:unknown";
  }

  function layoutTokenForElement(element) {
    if (!(element instanceof Element)) return "";
    if (element.dataset.projectId) return "p:" + element.dataset.projectId;
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
    if (layoutLocked()) return Promise.resolve(null);
    const mode = activeGroupMode();

    if (mode === "project") {
      if (!draggedToken.startsWith("p:") || !targetToken.startsWith("p:")) {
        return Promise.resolve(null);
      }
      const tokens = currentLayoutTokens()
        .filter((token) => token.startsWith("p:") && token !== draggedToken);
      let targetIndex = tokens.indexOf(targetToken);
      if (targetIndex < 0) return Promise.resolve(null);
      if (!before) targetIndex += 1;
      tokens.splice(targetIndex, 0, draggedToken);

      return sendMessage({
        type: "monitor-set-project-order",
        projectKeys: tokens.map((token) => token.slice(2))
      }).then((response) => {
        if (response?.ok && response.undoId) showLayoutUndo("Project moved", response.undoId);
        return response;
      });
    }

    const tokens = currentLayoutTokens().filter((token) => token !== draggedToken);
    let targetIndex = tokens.indexOf(targetToken);
    if (targetIndex < 0) return Promise.resolve(null);
    if (!before) targetIndex += 1;
    tokens.splice(targetIndex, 0, draggedToken);

    const message = mode === "none"
      ? {
          type: "monitor-set-chat-order",
          chatKeys: tokens
            .filter((token) => token.startsWith("c:"))
            .map((token) => token.slice(2))
        }
      : { type: "monitor-set-layout", tokens };

    return sendMessage(message).then((response) => {
      if (response?.ok && response.undoId) {
        showLayoutUndo(draggedToken.startsWith("s:") ? "Section moved" : "Chat moved", response.undoId);
      }
      return response;
    });
  }

  function visibleGroupFor(chat) {
    const now = Date.now();
    const mode = activeGroupMode();
    if (mode === "project") return [];

    return chats.filter((item) => {
      if (item.hidden || item.pinned !== chat.pinned || !isRecent(item, now)) return false;
      if (mode === "manual" && separators.length) {
        return item.section === chat.section && item.state === chat.state;
      }
      return true;
    });
  }

  function persistGroupOrder(group) {
    return sendMessage({
      type: "monitor-set-chat-order",
      chatKeys: group.map((item) => item.chatKey)
    }).then((response) => {
      if (response?.ok && response.undoId) showLayoutUndo("Chat moved", response.undoId);
      return response;
    });
  }

  function moveChat(chat, direction) {
    if (layoutLocked() || activeGroupMode() === "project") return Promise.resolve(null);
    const group = visibleGroupFor(chat);
    const index = group.findIndex((item) => item.chatKey === chat.chatKey);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= group.length) return Promise.resolve(null);

    const reordered = [...group];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    return persistGroupOrder(reordered);
  }

  function hideLayoutUndo() {
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    currentUndoId = "";
    if (undoButton) {
      undoButton.hidden = true;
      undoButton.removeAttribute("data-undo-id");
    }
  }

  function showLayoutUndo(label, undoId) {
    if (layoutLocked() || !undoButton || !undoId) return;
    hideLayoutUndo();
    currentUndoId = undoId;
    undoButton.dataset.undoId = undoId;
    undoButton.hidden = false;
    undoButton.title = "Undo: " + label;
    undoButton.setAttribute("aria-label", "Undo " + label.toLowerCase());
    undoTimer = setTimeout(hideLayoutUndo, 6500);
  }

  function setSectionCollapsed(descriptor, collapsed) {
    if (layoutLocked() || !descriptor?.uiId) return Promise.resolve(null);
    return sendMessage({
      type: "monitor-set-section-collapsed",
      sectionKey: descriptor.uiId,
      collapsed: collapsed === true
    }).then((response) => {
      if (response?.ok && response.undoId) {
        showLayoutUndo(collapsed ? "Section collapsed" : "Section expanded", response.undoId);
      }
      return response;
    });
  }

  function renameManualSection(descriptor, name) {
    if (layoutLocked() || descriptor?.kind !== "manual" || !descriptor.id) return Promise.resolve(null);
    return sendMessage({
      type: "monitor-set-separator-meta",
      id: descriptor.id,
      patch: { name }
    }).then((response) => {
      if (response?.ok && response.undoId) showLayoutUndo("Section renamed", response.undoId);
      return response;
    });
  }

  function moveManualSection(descriptor, direction) {
    if (layoutLocked() || descriptor?.kind !== "manual" || !descriptor.id) return Promise.resolve(null);
    return sendMessage({
      type: "monitor-move-separator",
      id: descriptor.id,
      direction
    }).then((response) => {
      if (response?.ok && response.undoId) showLayoutUndo("Section moved", response.undoId);
      return response;
    });
  }

  function moveProjectSection(descriptor, direction) {
    if (layoutLocked() || descriptor?.kind !== "project" || !descriptor.uiId) return Promise.resolve(null);
    const now = Date.now();
    const groups = projectDescriptors(chats.filter((chat) => isRecent(chat, now)));
    const index = groups.findIndex((item) => item.uiId === descriptor.uiId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= groups.length) return Promise.resolve(null);

    const reordered = [...groups];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);

    return sendMessage({
      type: "monitor-set-project-order",
      projectKeys: reordered.map((item) => item.uiId)
    }).then((response) => {
      if (response?.ok && response.undoId) showLayoutUndo("Project moved", response.undoId);
      return response;
    });
  }

  function createSectionDropzone(sectionId, isEmpty) {
    const zone = document.createElement("div");
    zone.className = "section-dropzone" + (isEmpty ? " empty-section" : "");
    zone.dataset.sectionId = sectionId;
    zone.textContent = "Drop here";
    zone.setAttribute("aria-hidden", "true");
    sectionDropNodes.set(sectionId, zone);
    return zone;
  }

  function clearDropMarkers() {
    dropTarget = null;
    for (const node of rowNodes.values()) {
      node.row.classList.remove("drop-before", "drop-after", "drop-section");
    }
    for (const node of separatorNodes.values()) {
      node.row.classList.remove("drop-before", "drop-after", "drop-section");
    }
    for (const zone of sectionDropNodes.values()) {
      zone.classList.remove("drop-section");
    }
  }

  function markDropSection(sectionId) {
    for (const node of rowNodes.values()) {
      node.row.classList.toggle("drop-section", (node.row.dataset.sectionId || "") === sectionId);
    }
    for (const node of separatorNodes.values()) {
      node.row.classList.toggle("drop-section", (node.row.dataset.sectionId || "") === sectionId);
    }
    for (const [id, zone] of sectionDropNodes) {
      zone.classList.toggle("drop-section", id === sectionId);
    }
  }

  function finishLayoutDrag() {
    draggedChatKey = null;
    draggedSectionToken = null;
    if (list) list.classList.remove("layout-dragging", "chat-dragging");
    for (const node of rowNodes.values()) node.row.classList.remove("drag-source");
    for (const node of separatorNodes.values()) node.row.classList.remove("drag-source");
    for (const zone of sectionDropNodes.values()) {
      zone.classList.remove("source-will-empty");
    }
    clearDropMarkers();
  }

  function closeMenus() {
    openMenuTabId = null;
    openMenuSectionId = null;
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

  function beginSectionRename(node) {
    const descriptor = node?.descriptor;
    if (layoutLocked() || !descriptor || descriptor.kind !== "manual") return;
    clearTimeout(node.captionClickTimer);
    node.caption.hidden = true;
    node.input.hidden = false;
    node.input.value = descriptor.name || "";
    node.input.focus();
    node.input.select();

    let settled = false;
    const finish = (save) => {
      if (settled) return;
      settled = true;
      const value = node.input.value;
      node.input.hidden = true;
      node.caption.hidden = !descriptor.name;
      if (save) renameManualSection(descriptor, value);
    };

    node.input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    node.input.onblur = () => finish(true);
  }

  function createSeparatorRow(uiId) {
    const row = document.createElement("div");
    row.className = "section-separator";
    row.dataset.groupId = uiId;

    const before = document.createElement("span");
    before.className = "separator-rule separator-rule-before";

    const caption = document.createElement("span");
    caption.className = "separator-caption";
    caption.tabIndex = 0;
    caption.setAttribute("role", "button");
    caption.setAttribute("aria-label", "Collapse or expand section");

    const input = document.createElement("input");
    input.className = "separator-input";
    input.type = "text";
    input.maxLength = 40;
    input.hidden = true;
    input.setAttribute("aria-label", "Section name");

    const after = document.createElement("span");
    after.className = "separator-rule separator-rule-after";

    const count = document.createElement("span");
    count.className = "separator-count";
    count.hidden = true;

    const more = document.createElement("button");
    more.type = "button";
    more.className = "separator-more";
    more.textContent = "...";
    more.title = "Section options";
    more.setAttribute("aria-label", "Section options");
    more.draggable = false;

    row.append(before, caption, input, after, count, more);

    const node = {
      row,
      before,
      caption,
      input,
      after,
      count,
      more,
      descriptor: null,
      captionClickTimer: null
    };

    row.addEventListener("dragstart", (event) => {
      const descriptor = node.descriptor;
      const targetIsControl = event.target instanceof Element && event.target.closest("button,input");
      if (layoutLocked() ||
          !descriptor ||
          !["manual", "project"].includes(descriptor.kind) ||
          targetIsControl) {
        event.preventDefault();
        return;
      }

      draggedSectionToken = descriptor.kind === "project"
        ? "p:" + descriptor.uiId
        : "s:" + descriptor.id;
      draggedChatKey = null;
      row.classList.add("drag-source");
      list.classList.add("layout-dragging");
      list.classList.remove("chat-dragging");
      closeMenus();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedSectionToken);
      }
    });

    row.addEventListener("dragend", finishLayoutDrag);

    caption.addEventListener("click", (event) => {
      event.stopPropagation();
      const descriptor = node.descriptor;
      if (layoutLocked() || !descriptor) return;
      clearTimeout(node.captionClickTimer);
      node.captionClickTimer = setTimeout(() => {
        setSectionCollapsed(descriptor, !descriptor.collapsed);
      }, 220);
    });

    caption.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(node.captionClickTimer);
      if (!layoutLocked() && node.descriptor?.kind === "manual") beginSectionRename(node);
    });

    caption.addEventListener("keydown", (event) => {
      const descriptor = node.descriptor;
      if (layoutLocked() || !descriptor) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSectionCollapsed(descriptor, !descriptor.collapsed);
      } else if (event.key === "F2" && descriptor.kind === "manual") {
        event.preventDefault();
        beginSectionRename(node);
      }
    });

    row.addEventListener("dblclick", (event) => {
      if (layoutLocked() || event.target.closest("button,input,.separator-caption")) return;
      if (node.descriptor?.kind === "manual") beginSectionRename(node);
    });

    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const descriptor = node.descriptor;
      if (layoutLocked() || !descriptor) return;
      const willOpen = openMenuSectionId !== descriptor.uiId;
      closeMenus();
      if (willOpen) {
        openMenuSectionId = descriptor.uiId;
        openSectionMenu(more, descriptor, node);
      }
    });

    row.addEventListener("contextmenu", (event) => {
      if (layoutLocked() || event.target.closest("input")) return;
      event.preventDefault();
      event.stopPropagation();
      const descriptor = node.descriptor;
      if (!descriptor) return;
      closeMenus();
      openMenuSectionId = descriptor.uiId;
      openSectionMenu(row, descriptor, node);
    });

    separatorNodes.set(uiId, node);
    return node;
  }

  function createRow(tabId) {
    const row = document.createElement("div");
    row.className = "chat-row";
    row.dataset.tabId = String(tabId);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "chat-main";

    const dot = document.createElement("span");
    dot.className = "dot";

    const copy = document.createElement("span");
    copy.className = "copy";
    copy.draggable = true;
    copy.title = "Drag to reorder";
    copy.setAttribute("aria-label", "Drag chat to reorder");

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

    row.append(main, more);

    const node = {
      row,
      main,
      dot,
      copy,
      title,
      meta,
      more,
      chat: null
    };

    copy.addEventListener("dragstart", (event) => {
      if (layoutLocked() || !node.chat || activeGroupMode() === "project") {
        event.preventDefault();
        return;
      }

      draggedChatKey = node.chat.chatKey;
      draggedSectionToken = null;
      row.classList.add("drag-source");
      list.classList.add("layout-dragging", "chat-dragging");
      closeMenus();

      const sourceSection = node.chat.section || "";
      if (activeGroupMode() === "manual") {
        const members = chats.filter((item) =>
          !item.hidden &&
          (item.section || "") === sourceSection &&
          isRecent(item, Date.now())
        );
        if (members.length === 1) {
          sectionDropNodes.get(sourceSection)?.classList.add("source-will-empty");
        }
      }

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedChatKey);
      }
    });

    copy.addEventListener("dragend", finishLayoutDrag);

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

    if (!layoutLocked() && activeGroupMode() !== "project") {
      floatingMenu.append(
        createMenuButton("Move up", () => {
          moveChat(chat, -1).then(closeMenus);
        }),
        createMenuButton("Move down", () => {
          moveChat(chat, 1).then(closeMenus);
        })
      );
    }

    floatingMenu.append(
      createMenuButton("Hide", () => {
        setChatPreference(chat.chatKey, { hidden: true }).then(closeMenus);
      })
    );
  }

  function positionFloatingMenu(anchor) {
    if (!floatingMenu) return;
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

  function openFloatingMenu(anchor, chat) {
    if (!floatingMenu) return;
    rebuildFloatingMenu(chat);
    positionFloatingMenu(anchor);
  }

  function rebuildSectionMenu(descriptor, node) {
    if (!floatingMenu) return;
    floatingMenu.replaceChildren();

    if (descriptor.kind === "manual") {
      floatingMenu.append(
        createMenuButton(descriptor.name ? "Rename section" : "Name section", () => {
          closeMenus();
          beginSectionRename(node);
        })
      );
      if (descriptor.name) {
        floatingMenu.append(
          createMenuButton("Clear section name", () => {
            renameManualSection(descriptor, "").then(closeMenus);
          })
        );
      }
    }

    floatingMenu.append(
      createMenuButton(descriptor.collapsed ? "Expand section" : "Collapse section", () => {
        setSectionCollapsed(descriptor, !descriptor.collapsed).then(closeMenus);
      })
    );

    if (descriptor.kind === "manual") {
      floatingMenu.append(
        createMenuButton("Move section up", () => {
          moveManualSection(descriptor, -1).then(closeMenus);
        }),
        createMenuButton("Move section down", () => {
          moveManualSection(descriptor, 1).then(closeMenus);
        }),
        createMenuButton("Delete section", () => {
          if (layoutLocked()) return closeMenus();
          sendMessage({ type: "monitor-remove-separator", id: descriptor.id }).then((response) => {
            if (response?.ok && response.undoId) showLayoutUndo("Section removed", response.undoId);
            closeMenus();
          });
        })
      );
    } else if (descriptor.kind === "project") {
      floatingMenu.append(
        createMenuButton("Move project up", () => {
          moveProjectSection(descriptor, -1).then(closeMenus);
        }),
        createMenuButton("Move project down", () => {
          moveProjectSection(descriptor, 1).then(closeMenus);
        })
      );
    }
  }

  function openSectionMenu(anchor, descriptor, node) {
    if (!floatingMenu) return;
    rebuildSectionMenu(descriptor, node);
    positionFloatingMenu(anchor);
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
    if (["light", "dark", "cozy", "neon", "minimal"].includes(value)) return value;
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

    const activeOpacity = normalizedOpacity();
    const idleOpacity = settings.monitorHoverFocus === true
      ? Math.max(0.25, activeOpacity * 0.58)
      : activeOpacity;

    panel.style.setProperty("--monitor-active-opacity", String(activeOpacity));
    panel.style.setProperty("--monitor-idle-opacity", String(idleOpacity));
    if (floatingMenu) floatingMenu.style.opacity = String(activeOpacity);
  }

  function applyPanelSize(size = settings.monitorSize) {
    if (!panel) return;
    const manualSize = normalizedPanelSize(size);
    const canResize = settings.monitorCollapsed !== true && settings.monitorCompact !== true;
    const editAllowed = !layoutLocked();

    panel.classList.toggle("manual-size", canResize && !!manualSize);
    panel.classList.toggle("auto-fit", canResize && !manualSize);
    if (resizeHandle) resizeHandle.hidden = !canResize || !editAllowed;
    if (autoSizeButton) {
      autoSizeButton.disabled = !editAllowed || !canResize || !manualSize;
      autoSizeButton.title = !editAllowed
        ? "Unlock layout to change monitor size"
        : manualSize
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

  function updateSeparatorNode(node, descriptor) {
    const locked = layoutLocked();
    node.descriptor = descriptor;
    node.row.className = "section-separator";
    node.row.classList.toggle("project-section", descriptor.kind === "project");
    node.row.classList.toggle("collapsed-section", descriptor.collapsed === true);
    node.row.classList.toggle("unnamed-section", !descriptor.name);
    node.row.dataset.groupId = descriptor.uiId;
    node.row.dataset.sectionId = descriptor.kind === "manual" ? descriptor.id : descriptor.uiId;
    node.row.draggable = !locked && ["manual", "project"].includes(descriptor.kind);

    if (descriptor.kind === "manual") {
      node.row.dataset.separatorId = descriptor.id;
      delete node.row.dataset.projectId;
      node.row.title = locked
        ? "Layout locked"
        : "Drag section · double-click to rename";
    } else {
      node.row.dataset.projectId = descriptor.uiId;
      delete node.row.dataset.separatorId;
      node.row.title = locked
        ? "Layout locked"
        : "Drag project to reorder";
    }

    node.caption.textContent = descriptor.name || "";
    node.caption.hidden = !descriptor.name;
    node.caption.title = locked
      ? "Layout locked"
      : descriptor.kind === "manual"
        ? "Click to collapse or expand · double-click to rename"
        : "Click to collapse or expand";
    node.caption.setAttribute("aria-disabled", locked ? "true" : "false");
    node.caption.tabIndex = locked ? -1 : 0;
    node.input.hidden = true;
    node.input.disabled = locked;
    node.count.textContent = descriptor.collapsed && descriptor.count
      ? descriptor.count + " chat" + (descriptor.count === 1 ? "" : "s")
      : "";
    node.count.hidden = !node.count.textContent;
    node.more.hidden = locked;
    node.more.title = descriptor.kind === "manual" ? "Section options" : "Project options";
  }

  function projectScopedDisplayTitle(chat, mode) {
    const title = String(chat.displayTitle || chat.title || "ChatGPT").trim();
    if (mode !== "project" || chat.alias || !chat.projectKey) return title;

    const projectName = String(chat.projectName || "").trim();
    if (!projectName) return title;

    const escapedProjectName = projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = new RegExp("^" + escapedProjectName + "\\s*(?:[·•|:–—-])\\s*", "i");
    const shortened = title.replace(prefix, "").trim();
    return shortened || title;
  }

  function projectDescriptors(visible) {
    const byProject = new Map();
    for (const chat of visible) {
      const uiId = projectSectionKey(chat);
      let descriptor = byProject.get(uiId);
      if (!descriptor) {
        const fallbackName = chat.projectKnown === true ? "No project" : "Other chats";
        descriptor = {
          uiId,
          id: uiId,
          kind: "project",
          name: String(chat.projectName || "").trim() || fallbackName,
          collapsed: sectionUiState(uiId).collapsed === true,
          chats: []
        };
        byProject.set(uiId, descriptor);
      } else if (!descriptor.name && chat.projectName) {
        descriptor.name = chat.projectName;
      }
      descriptor.chats.push(chat);
    }
    return [...byProject.values()].map((descriptor) => ({
      ...descriptor,
      count: descriptor.chats.length
    }));
  }

  function render() {
    if (!panel || !host) return;

    host.style.display = settings.monitorEnabled === false ? "none" : "block";
    if (settings.monitorEnabled === false) return;

    const mode = activeGroupMode();
    const locked = layoutLocked();
    panel.dataset.groupMode = mode;
    panel.classList.toggle("collapsed", settings.monitorCollapsed === true);
    panel.classList.toggle("compact", settings.monitorCompact === true);
    panel.classList.toggle("no-animations", settings.monitorAnimations === false);
    panel.classList.toggle("layout-locked", locked);
    applyPanelSize();
    applyAppearance();
    collapseButton.textContent = settings.monitorCollapsed ? "+" : "-";
    collapseButton.title = settings.monitorCollapsed ? "Expand monitor" : "Collapse monitor";
    lockButton.textContent = locked ? "🔒" : "🔓";
    lockButton.title = locked ? "Unlock layout" : "Lock layout";
    lockButton.setAttribute("aria-label", locked ? "Unlock layout" : "Lock layout");
    lockButton.classList.toggle("is-locked", locked);
    addSeparatorButton.hidden = mode !== "manual";
    addSeparatorButton.disabled = locked;
    addSeparatorButton.title = locked ? "Unlock layout to add a separator" : "Add separator";
    if (footCopy) {
      footCopy.textContent = locked
        ? "Layout locked"
        : mode === "project"
          ? "Drag project headers to reorder"
          : mode === "manual"
            ? "Drag chat text or sections to reorganize"
            : "Click to switch · drag chat text to reorder";
    }

    const now = Date.now();
    const visible = chats.filter((chat) => isRecent(chat, now));
    const manualHasSections = mode === "manual" && separators.length > 0;
    const hasContent = visible.length > 0 || manualHasSections;
    panel.classList.toggle("is-empty", !hasContent);
    updateHeaderSummary(visible);

    const visibleIds = new Set(visible.map((chat) => chat.tabId));
    for (const [tabId, node] of rowNodes) {
      if (!visibleIds.has(tabId)) {
        node.row.remove();
        rowNodes.delete(tabId);
        renderedStates.delete(tabId);
      } else {
        node.row.remove();
      }
    }
    for (const node of separatorNodes.values()) node.row.remove();
    for (const zone of sectionDropNodes.values()) zone.remove();
    sectionDropNodes.clear();

    const desiredSeparatorIds = new Set();

    const appendChat = (chat, sectionId = "") => {
      const node = rowNodes.get(chat.tabId) || createRow(chat.tabId);
      node.chat = chat;
      node.row.dataset.chatKey = chat.chatKey;
      node.row.dataset.sectionId = sectionId;
      node.row.className = "chat-row state-" + chat.state;
      if (chat.url === location.href) node.row.classList.add("current");
      if (chat.pinned) node.row.classList.add("pinned");

      const canDrag = !locked && mode !== "project";
      node.copy.draggable = canDrag;
      node.copy.title = locked
        ? "Layout locked"
        : canDrag
          ? "Drag to reorder"
          : "Chats stay inside their ChatGPT project";
      node.copy.setAttribute(
        "aria-label",
        locked ? "Chat layout locked" : canDrag ? "Drag chat to reorder" : "Chat project grouping is automatic"
      );

      const visibleTitle = projectScopedDisplayTitle(chat, mode);
      node.title.textContent = (chat.pinned ? "📌 " : "") + visibleTitle;
      node.meta.textContent = statusText(chat, now);
      node.dot.title = chat.state === "idle"
        ? "Idle — right-click to mark Pending"
        : chat.state === "pending"
          ? "Pending — right-click to clear"
          : stateName(chat.state);
      node.dot.setAttribute("aria-label", stateName(chat.state));
      node.main.setAttribute(
        "aria-label",
        visibleTitle + ", " + node.meta.textContent
      );

      maybeFlash(node, chat);
      list.appendChild(node.row);
    };

    const appendDescriptor = (descriptor) => {
      desiredSeparatorIds.add(descriptor.uiId);
      const node = separatorNodes.get(descriptor.uiId) || createSeparatorRow(descriptor.uiId);
      updateSeparatorNode(node, descriptor);
      list.appendChild(node.row);
      if (!descriptor.collapsed) {
        for (const chat of descriptor.chats) {
          appendChat(chat, descriptor.kind === "manual" ? descriptor.id : descriptor.uiId);
        }
      } else {
        for (const chat of descriptor.chats) renderedStates.set(chat.tabId, chat.state);
      }
      return node;
    };

    if (mode === "project") {
      for (const descriptor of projectDescriptors(visible)) appendDescriptor(descriptor);
    } else if (mode === "manual") {
      const groups = new Map([["", []]]);
      for (const separator of separators) groups.set(separator.id, []);
      for (const chat of visible) {
        const section = groups.has(chat.section) ? chat.section : "";
        groups.get(section).push(chat);
      }

      const rootChats = groups.get("");
      for (const chat of rootChats) appendChat(chat, "");
      if (separators.length) {
        list.appendChild(createSectionDropzone("", rootChats.length === 0));
      }

      for (const separator of separators) {
        const sectionChats = groups.get(separator.id);
        const uiId = "manual:" + separator.id;
        const descriptor = {
          uiId,
          id: separator.id,
          kind: "manual",
          name: String(separator.name || "").trim(),
          collapsed: sectionUiState(uiId).collapsed === true || separator.collapsed === true,
          chats: sectionChats,
          count: sectionChats.length
        };
        appendDescriptor(descriptor);
        list.appendChild(createSectionDropzone(separator.id, sectionChats.length === 0 || descriptor.collapsed));
      }
    } else {
      for (const chat of visible) appendChat(chat, "");
    }

    for (const [id, node] of separatorNodes) {
      if (!desiredSeparatorIds.has(id)) {
        node.row.remove();
        separatorNodes.delete(id);
      }
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
      if (layoutLocked() || event.button !== 0 || event.target.closest("button")) return;
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
      if (layoutLocked() ||
          event.button !== 0 ||
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
      "border:1px solid #303846;border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.34);opacity:var(--monitor-idle-opacity,1);transition:opacity .16s ease}" +
      "#panel:hover,#panel:focus-within,#panel.hover-active,#panel.dragging,#panel.resizing{opacity:var(--monitor-active-opacity,1)}" +
      "#panel.dragging,#panel.resizing{user-select:none;box-shadow:0 20px 54px rgba(0,0,0,.42)}" +
      ".head{height:46px;display:flex;align-items:center;gap:8px;padding:0 9px 0 12px;cursor:grab;" +
      "border-bottom:1px solid #29313d}.head:active{cursor:grabbing}" +
      ".brand{font-weight:750;letter-spacing:-.01em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.summary{display:flex;align-items:center;gap:5px;white-space:nowrap}" +
      ".summary[hidden]{display:none}.count-badge{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;font-size:10px;font-weight:850;font-variant-numeric:tabular-nums;line-height:1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}" +
      ".count-badge[hidden]{display:none}.count-working{background:rgba(99,230,215,.13);color:#63e6d7}.count-done{background:rgba(167,243,107,.13);color:#a7f36b}.count-attention{background:rgba(240,163,90,.14);color:#f0a35a}.count-pending{background:rgba(244,114,182,.13);color:#f472b6}" +
      ".add-separator{position:relative;width:26px;height:26px;flex:0 0 auto;border:0;border-radius:7px;background:transparent;color:#7f8b9b;cursor:pointer}.add-separator[hidden]{display:none}.add-separator:hover:not(:disabled){background:#202731;color:#d9e0e8}.add-separator:disabled{opacity:.28;cursor:default}" +
      ".add-separator::before{content:'';position:absolute;left:7px;right:7px;top:9px;height:1px;background:currentColor;box-shadow:0 5px 0 currentColor}.add-separator::after{content:'+';position:absolute;right:3px;bottom:2px;width:10px;height:10px;display:grid;place-items:center;border-radius:50%;background:#12171f;color:currentColor;font:800 9px/1 system-ui}" +
      ".header-tool{width:26px;height:26px;flex:0 0 auto;border:0;border-radius:7px;background:transparent;color:#7f8b9b;display:grid;place-items:center;cursor:pointer;line-height:1}.header-tool:hover{background:#202731;color:#d9e0e8}.lock-button{font-size:13px}.lock-button.is-locked{color:#d6a25f}.undo-header{font:800 17px/1 system-ui;color:#74d8cc}.undo-header[hidden]{display:none}" +
      ".collapse{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#aeb8c7;" +
      "font-size:18px;line-height:1;cursor:pointer}.collapse:hover{background:#202731;color:white}.layout-locked .head{cursor:default}" +
      ".list{max-height:min(360px,58vh);min-height:0;overflow:auto;padding:7px}.manual-size{max-height:none}.manual-size .list{max-height:none;flex:1}.manual-size.is-empty .list{display:none}.manual-size.is-empty .empty{margin:auto 0}" +
      ".chat-row{position:relative;display:flex;align-items:center;gap:3px;border-radius:10px;background:transparent}" +
      ".chat-row:hover,.chat-row.current{background:#1a202a}.chat-row.drag-source,.section-separator.drag-source{opacity:.42}" +
      ".chat-row.drop-before::before,.chat-row.drop-after::after,.section-separator.drop-before::before,.section-separator.drop-after::after{content:'';position:absolute;left:7px;right:7px;height:2px;border-radius:999px;background:#63e6d7}" +
      ".chat-row.drop-before::before,.section-separator.drop-before::before{top:-1px}.chat-row.drop-after::after,.section-separator.drop-after::after{bottom:-1px}" +
      ".chat-row.drop-section{background:rgba(99,230,215,.045)}.section-separator.drop-section .separator-rule{background:rgba(99,230,215,.48)}" +
      ".section-dropzone{display:none;height:30px;margin:3px 5px;border:1px dashed #354052;border-radius:8px;align-items:center;justify-content:center;color:#697789;font:600 10px/1 system-ui;letter-spacing:.01em}.chat-dragging .section-dropzone.empty-section,.chat-dragging .section-dropzone.source-will-empty{display:flex}.section-dropzone.drop-section{border-color:rgba(99,230,215,.72);background:rgba(99,230,215,.06);color:#8bded4}" +
      ".section-separator{position:relative;height:28px;display:flex;align-items:center;gap:6px;padding:0 5px;user-select:none}.section-separator[draggable='true']{cursor:grab}.section-separator[draggable='true']:active{cursor:grabbing}.separator-rule{height:1px;min-width:10px;background:#3b424d}.separator-rule-before{flex:.38}.separator-rule-after{flex:1}.separator-caption{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8f929a;font:650 11px/1 system-ui;text-transform:uppercase;letter-spacing:.025em;cursor:pointer;outline:none}.separator-caption:focus-visible{color:#c4c8d0;text-decoration:underline;text-underline-offset:3px}.separator-caption[hidden]{display:none}.separator-input{min-width:70px;max-width:56%;height:21px;border:1px solid #485466;border-radius:5px;background:#171d26;color:#dce3ec;padding:0 5px;font:650 10px/1 system-ui;text-transform:uppercase;outline:none}.separator-input:focus{border-color:#63e6d7}.separator-count{flex:0 0 auto;color:#687386;font:600 9px/1 system-ui;white-space:nowrap}.separator-count[hidden]{display:none}.separator-more{width:20px;height:20px;flex:0 0 auto;border:0;border-radius:6px;background:transparent;color:#687386;font:750 10px/1 system-ui;cursor:pointer;opacity:0}.section-separator:hover .separator-more,.separator-more:focus-visible{opacity:.82}.separator-more:hover{background:#252d38;color:#d9e0e8}.unnamed-section .separator-rule-before{display:none}.unnamed-section .separator-rule-after{flex:1}.project-section .separator-caption{color:#9b9da5}.collapsed-section .separator-caption{color:#afb2ba}.collapsed-section .separator-rule{background:#454d59}" +

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
      ".copy{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px;flex:1;align-self:stretch;margin:-9px 0;padding:9px 0;cursor:grab;user-select:none}.copy:active{cursor:grabbing}.copy[draggable='false']{cursor:default}.copy[draggable='false']:active{cursor:default}" +
      ".chat-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}" +
      ".meta{color:#8e9bad;font-size:11px}.pinned .chat-title{color:#fff}" +
      ".floating-menu{position:fixed;z-index:2147483647;width:144px;padding:5px;border:1px solid #384250;" +
      "border-radius:9px;background:#171d26;box-shadow:0 10px 26px rgba(0,0,0,.4);pointer-events:auto}" +
      ".menu-action{display:block;width:100%;border:0;border-radius:6px;padding:7px 8px;background:transparent;" +
      "color:#d9e0e8;text-align:left;font:12px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer}" +
      ".menu-action:hover{background:#252d38}" +
      ".empty{padding:18px 14px 20px;color:#8e9bad;text-align:center;font-size:12px}" +
      ".foot{min-height:35px;display:flex;align-items:center;justify-content:center;gap:8px;padding:7px 9px 8px 12px;color:#6f7c8e;text-align:center;font-size:10px;border-top:1px solid #29313d}" +
      ".foot-copy{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.version-label{flex:0 0 auto;color:#566274;font:600 9px/1 system-ui;font-variant-numeric:tabular-nums}.auto-size-button{display:inline-flex;align-items:center;flex:0 0 auto;height:22px;padding:0 7px;border:1px solid #354052;border-radius:7px;background:#171d26;color:#aeb8c7;font:600 10px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer}" +
      ".auto-size-button:hover:not(:disabled){background:#252d38;color:#fff;border-color:#465267}.auto-size-button:disabled{opacity:.38;cursor:default}" +
      "#panel.collapsed{width:215px}.collapsed .list,.collapsed .empty,.collapsed .foot,.collapsed .add-separator{display:none}" +
      ".collapsed .head{border-bottom:0;gap:5px}.collapsed .brand{font-size:0}.collapsed .brand::after{content:'Monitor';font-size:11px}.collapsed .summary{gap:3px}.collapsed .count-badge{width:18px;height:18px;font-size:9px}" +
      "#panel.compact{width:214px}#panel.compact.collapsed{width:214px}" +
      ".compact .head{height:36px;padding:0 6px 0 9px;gap:3px}.compact .brand{font-size:0}.compact .brand::after{content:'Monitor';font-size:11px}" +
      ".compact .summary{gap:3px}.compact .count-badge{width:18px;height:18px;font-size:9px}.compact .add-separator{width:22px;height:22px}.compact .add-separator::before{left:6px;right:6px;top:7px;box-shadow:0 5px 0 currentColor}.compact .add-separator::after{right:2px;bottom:1px}.compact .meta,.compact .foot,.compact .version-label{display:none}" +
      ".compact .list{padding:3px}.compact .chat-main{padding:5px 4px 5px 7px;gap:7px}.compact .copy{margin:-5px 0;padding:5px 0}.compact .section-separator{height:22px;gap:4px}.compact .separator-caption{font-size:9px;max-width:50%}.compact .separator-count{font-size:8px}.compact .separator-more{width:17px;height:17px}.compact .section-dropzone{height:24px;margin:2px 4px}.compact .header-tool{width:19px;height:19px;border-radius:5px}.compact .lock-button{font-size:10px}.compact .undo-header{font-size:14px}.compact .collapse{width:24px;height:24px}" +

      ".compact .more{width:22px;height:22px;margin-right:2px;opacity:.18;transition:opacity .12s}.compact .chat-row:hover .more,.compact .more:focus-visible{opacity:1}" +
      ".compact .dot{width:8px;height:8px}" +
      ".resize-handle{position:absolute;right:3px;bottom:3px;width:19px;height:19px;border:0;border-radius:0 0 10px 0;cursor:nwse-resize;touch-action:none;opacity:.38;" +
      "background:linear-gradient(135deg,transparent 0 52%,#718095 53% 58%,transparent 59% 68%,#718095 69% 74%,transparent 75%);transition:opacity .12s}" +
      ".resize-handle:hover,.resizing .resize-handle{opacity:.86}.compact .resize-handle,.collapsed .resize-handle{display:none}" +
      ":host([data-theme='light']) #panel{color:#1d2836;background:#f7f9fc;border-color:#d5dde8;box-shadow:0 16px 44px rgba(31,43,58,.2)}" +
      ":host([data-theme='light']) #panel.dragging,:host([data-theme='light']) #panel.resizing{box-shadow:0 20px 54px rgba(31,43,58,.26)}" +
      ":host([data-theme='light']) .head{border-bottom-color:#dce3ec}:host([data-theme='light']) .count-badge{box-shadow:inset 0 0 0 1px rgba(31,43,58,.06)}:host([data-theme='light']) .count-working{background:rgba(35,143,132,.11);color:#238f84}:host([data-theme='light']) .count-done{background:rgba(90,142,38,.11);color:#5a8e26}:host([data-theme='light']) .count-pending{background:rgba(182,59,125,.1);color:#b63b7d}:host([data-theme='light']) .count-attention{background:rgba(164,91,31,.11);color:#a45b1f}" +
      ":host([data-theme='light']) .add-separator{color:#6c798b}:host([data-theme='light']) .add-separator:hover:not(:disabled){background:#e8edf3;color:#263342}:host([data-theme='light']) .add-separator::after{background:#f7f9fc}:host([data-theme='light']) .header-tool{color:#6c798b}:host([data-theme='light']) .header-tool:hover{background:#e8edf3;color:#263342}:host([data-theme='light']) .lock-button.is-locked{color:#9a6827}:host([data-theme='light']) .undo-header{color:#238f84}:host([data-theme='light']) .collapse{color:#647286}:host([data-theme='light']) .collapse:hover{background:#e8edf3;color:#182331}" +
      ":host([data-theme='light']) .chat-row:hover,:host([data-theme='light']) .chat-row.current{background:#eaf0f6}:host([data-theme='light']) .chat-row.drop-section{background:rgba(35,143,132,.065)}" +
      ":host([data-theme='light']) .separator-rule{background:#c8ced7}:host([data-theme='light']) .section-separator.drop-section .separator-rule{background:rgba(35,143,132,.5)}:host([data-theme='light']) .separator-caption{color:#7a7f88}:host([data-theme='light']) .collapsed-section .separator-caption{color:#5f6670}:host([data-theme='light']) .separator-input{border-color:#c4ced9;background:#fff;color:#313b48}:host([data-theme='light']) .separator-count{color:#8390a0}:host([data-theme='light']) .section-dropzone{border-color:#c7d2df;color:#8190a2}:host([data-theme='light']) .section-dropzone.drop-section{border-color:rgba(35,143,132,.58);background:rgba(35,143,132,.055);color:#287f77}:host([data-theme='light']) .separator-more{color:#8794a5}:host([data-theme='light']) .separator-more:hover{background:#e8edf3;color:#263342}" +
      ":host([data-theme='light']) .more{color:#6c798b}:host([data-theme='light']) .more:hover{background:#dfe6ee;color:#182331}" +
      ":host([data-theme='light']) .meta{color:#68778b}:host([data-theme='light']) .pinned .chat-title{color:#17212d}" +
      ":host([data-theme='light']) .floating-menu{border-color:#ced7e2;background:#ffffff;box-shadow:0 10px 26px rgba(31,43,58,.2)}" +
      ":host([data-theme='light']) .menu-action{color:#263342}:host([data-theme='light']) .menu-action:hover{background:#edf2f7}" +
      ":host([data-theme='light']) .empty{color:#748196}:host([data-theme='light']) .foot{color:#7c899b;border-top-color:#dce3ec}:host([data-theme='light']) .version-label{color:#99a4b2}" +
      ":host([data-theme='light']) .auto-size-button{border-color:#ccd5df;background:#f8fafc;color:#5c6a7c}:host([data-theme='light']) .auto-size-button:hover{background:#e9eff5;color:#182331;border-color:#b8c4d1}" +
      ":host([data-theme='light']) .resize-handle{background:linear-gradient(135deg,transparent 0 52%,#7d8998 53% 58%,transparent 59% 68%,#7d8998 69% 74%,transparent 75%)}" +
      ":host([data-theme='cozy']) *{font-family:'Trebuchet MS',system-ui,sans-serif}:host([data-theme='cozy']) #panel{color:#f5eadf;background:#2c2621;border-color:#5b4b3f;box-shadow:0 16px 44px rgba(30,18,10,.38)}:host([data-theme='cozy']) .head{border-bottom-color:#4a3d33}:host([data-theme='cozy']) .chat-row:hover,:host([data-theme='cozy']) .chat-row.current{background:#3a312a}:host([data-theme='cozy']) .separator-rule{background:#655347}:host([data-theme='cozy']) .separator-caption{color:#c0a992}:host([data-theme='cozy']) .more:hover,:host([data-theme='cozy']) .header-tool:hover,:host([data-theme='cozy']) .collapse:hover{background:#43382f;color:#fff4e9}:host([data-theme='cozy']) .foot{color:#b29b86;border-top-color:#4a3d33}:host([data-theme='cozy']) .floating-menu{border-color:#5b4b3f;background:#302821;box-shadow:0 10px 26px rgba(25,14,8,.36)}:host([data-theme='cozy']) .menu-action{color:#f0e2d4}:host([data-theme='cozy']) .menu-action:hover{background:#43382f}" +
      ":host([data-theme='neon']) *{font-family:Consolas,'Courier New',monospace}:host([data-theme='neon']) #panel{color:#eaffff;background:#07101a;border-color:#24536c;box-shadow:0 0 0 1px rgba(0,245,212,.06),0 18px 46px rgba(0,0,0,.5)}:host([data-theme='neon']) .head{border-bottom-color:#173d52}:host([data-theme='neon']) .brand{color:#bffff8}:host([data-theme='neon']) .chat-row:hover,:host([data-theme='neon']) .chat-row.current{background:#0d1d2b}:host([data-theme='neon']) .separator-rule{background:#244b64}:host([data-theme='neon']) .separator-caption{color:#8edbd5}:host([data-theme='neon']) .more:hover,:host([data-theme='neon']) .header-tool:hover,:host([data-theme='neon']) .collapse:hover{background:#102737;color:#00f5d4}:host([data-theme='neon']) .lock-button.is-locked{color:#d08cff}:host([data-theme='neon']) .foot{color:#7299aa;border-top-color:#173d52}:host([data-theme='neon']) .auto-size-button{border-color:#24536c;background:#081722;color:#8edbd5}:host([data-theme='neon']) .auto-size-button:hover{background:#102737;color:#00f5d4}:host([data-theme='neon']) .floating-menu{border-color:#24536c;background:#07111b;box-shadow:0 0 24px rgba(0,245,212,.09)}:host([data-theme='neon']) .menu-action{color:#dffcff}:host([data-theme='neon']) .menu-action:hover{background:#102737;color:#00f5d4}" +
      ":host([data-theme='minimal']) *{font-family:Arial,Helvetica,sans-serif}:host([data-theme='minimal']) #panel{color:#222;background:#fbfbfa;border-color:#d9d9d6;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.12)}:host([data-theme='minimal']) .head{border-bottom-color:#e2e2df}:host([data-theme='minimal']) .count-badge{box-shadow:none}:host([data-theme='minimal']) .add-separator{color:#777}:host([data-theme='minimal']) .add-separator:hover:not(:disabled){background:#ececea;color:#222}:host([data-theme='minimal']) .add-separator::after{background:#fbfbfa}:host([data-theme='minimal']) .undo-header{color:#444}:host([data-theme='minimal']) .chat-row:hover,:host([data-theme='minimal']) .chat-row.current{background:#f0f0ed}:host([data-theme='minimal']) .separator-rule{background:#d3d3d0}:host([data-theme='minimal']) .separator-caption{color:#737373}:host([data-theme='minimal']) .separator-input{border-color:#ccccca;background:#fff;color:#222}:host([data-theme='minimal']) .separator-count{color:#888}:host([data-theme='minimal']) .section-dropzone{border-color:#ccccca;color:#888}:host([data-theme='minimal']) .section-dropzone.drop-section{border-color:#888;background:#f2f2ef;color:#444}:host([data-theme='minimal']) .more,:host([data-theme='minimal']) .header-tool,:host([data-theme='minimal']) .collapse{color:#6d6d6d}:host([data-theme='minimal']) .more:hover,:host([data-theme='minimal']) .header-tool:hover,:host([data-theme='minimal']) .collapse:hover{background:#ececea;color:#222}:host([data-theme='minimal']) .lock-button.is-locked{color:#444}:host([data-theme='minimal']) .meta{color:#777}:host([data-theme='minimal']) .pinned .chat-title{color:#111}:host([data-theme='minimal']) .empty{color:#777}:host([data-theme='minimal']) .foot{color:#777;border-top-color:#e2e2df}:host([data-theme='minimal']) .version-label{color:#999}:host([data-theme='minimal']) .auto-size-button{border-color:#d2d2cf;background:#fff;color:#555}:host([data-theme='minimal']) .auto-size-button:hover{background:#ececea;color:#222}:host([data-theme='minimal']) .resize-handle{background:linear-gradient(135deg,transparent 0 52%,#888 53% 58%,transparent 59% 68%,#888 69% 74%,transparent 75%)}:host([data-theme='minimal']) .floating-menu{border-color:#d9d9d6;background:#fff;box-shadow:0 10px 24px rgba(0,0,0,.12)}:host([data-theme='minimal']) .menu-action{color:#333}:host([data-theme='minimal']) .menu-action:hover{background:#efefed}" +
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

    lockButton = document.createElement("button");
    lockButton.className = "header-tool lock-button";
    lockButton.type = "button";

    undoButton = document.createElement("button");
    undoButton.className = "header-tool undo-header";
    undoButton.type = "button";
    undoButton.textContent = "↶";
    undoButton.hidden = true;
    undoButton.title = "Undo last layout change";
    undoButton.setAttribute("aria-label", "Undo last layout change");

    collapseButton = document.createElement("button");
    collapseButton.className = "collapse";
    collapseButton.type = "button";

    header.append(brand, summary, addSeparatorButton, undoButton, lockButton, collapseButton);

    list = document.createElement("div");
    list.className = "list";

    empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No active chats";

    const foot = document.createElement("div");
    foot.className = "foot";

    footCopy = document.createElement("span");
    footCopy.className = "foot-copy";
    footCopy.textContent = "Click to switch · drag the chat text to reorder";

    const versionLabel = document.createElement("span");
    versionLabel.className = "version-label";
    versionLabel.textContent = "v" + chrome.runtime.getManifest().version;
    versionLabel.title = "Extension version " + chrome.runtime.getManifest().version;
    versionLabel.setAttribute("aria-label", "Extension version " + chrome.runtime.getManifest().version);

    autoSizeButton = document.createElement("button");
    autoSizeButton.className = "auto-size-button";
    autoSizeButton.type = "button";
    autoSizeButton.textContent = "Auto size";
    autoSizeButton.title = "Fit monitor to the visible chats";
    autoSizeButton.setAttribute("aria-label", "Return monitor to automatic size");

    foot.append(footCopy, versionLabel, autoSizeButton);

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

    const setHoverFocusActive = (active) => {
      panel.classList.toggle("hover-active", active);
    };
    panel.addEventListener("pointerenter", () => setHoverFocusActive(true));
    panel.addEventListener("pointerleave", (event) => {
      if (event.relatedTarget instanceof Node && floatingMenu?.contains(event.relatedTarget)) return;
      setHoverFocusActive(false);
    });
    floatingMenu.addEventListener("pointerenter", () => setHoverFocusActive(true));
    floatingMenu.addEventListener("pointerleave", (event) => {
      if (event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)) return;
      setHoverFocusActive(false);
    });

    addSeparatorButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (layoutLocked()) return;
      sendMessage({ type: "monitor-add-separator" }).then((response) => {
        if (response?.ok && response.undoId) showLayoutUndo("Separator added", response.undoId);
      });
    });

    undoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const undoId = currentUndoId || undoButton.dataset.undoId || "";
      hideLayoutUndo();
      if (undoId) sendMessage({ type: "monitor-undo-layout", undoId });
    });

    lockButton.addEventListener("click", (event) => {
      event.stopPropagation();
      settings.monitorLayoutLocked = !layoutLocked();
      chrome.storage.local.set({
        monitorLayoutLocked: settings.monitorLayoutLocked
      });
      if (layoutLocked()) hideLayoutUndo();
      finishLayoutDrag();
      closeMenus();
      render();
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
      if (layoutLocked()) return;
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
      if (layoutLocked()) return;
      const draggedToken = draggedSectionToken || (draggedChatKey ? "c:" + draggedChatKey : "");
      if (!draggedToken) return;

      const rawTarget = event.target instanceof Element
        ? event.target.closest(".chat-row, .section-separator, .section-dropzone")
        : null;
      if (!rawTarget) return;

      if (draggedToken.startsWith("p:")) {
        let projectId = "";
        let visualTarget = rawTarget;
        let before = false;

        if (rawTarget.classList.contains("chat-row")) {
          projectId = rawTarget.dataset.sectionId || "";
          visualTarget = separatorNodes.get(projectId)?.row || rawTarget;
          before = false;
        } else if (rawTarget.classList.contains("project-section")) {
          projectId = rawTarget.dataset.projectId || "";
          const rect = rawTarget.getBoundingClientRect();
          before = event.clientY < rect.top + rect.height / 2;
        } else {
          return;
        }

        const targetToken = projectId ? "p:" + projectId : "";
        if (!targetToken || targetToken === draggedToken) return;

        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        clearDropMarkers();
        visualTarget.classList.add(before ? "drop-before" : "drop-after");
        markDropSection(projectId);
        dropTarget = { token: targetToken, before };
        return;
      }

      let targetToken = "";
      let before = false;
      let targetSection = "";

      if (rawTarget.classList.contains("section-dropzone")) {
        targetSection = rawTarget.dataset.sectionId || "";
        if (targetSection) {
          targetToken = "s:" + targetSection;
          before = false;
        } else {
          const firstSeparator = separators[0]?.id || "";
          if (!firstSeparator) return;
          targetToken = "s:" + firstSeparator;
          before = true;
        }
      } else {
        targetToken = layoutTokenForElement(rawTarget);
        if (!targetToken || targetToken === draggedToken || targetToken.startsWith("p:")) return;
        const rect = rawTarget.getBoundingClientRect();
        before = event.clientY < rect.top + rect.height / 2;

        if (rawTarget.classList.contains("chat-row")) {
          targetSection = rawTarget.dataset.sectionId || "";
        } else {
          const separatorId = rawTarget.dataset.separatorId || "";
          if (!before) {
            targetSection = separatorId;
          } else {
            const index = separators.findIndex((item) => item.id === separatorId);
            targetSection = index > 0 ? separators[index - 1].id : "";
          }
        }
      }

      if (!targetToken || targetToken === draggedToken) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      clearDropMarkers();
      if (!rawTarget.classList.contains("section-dropzone")) {
        rawTarget.classList.add(before ? "drop-before" : "drop-after");
      }
      markDropSection(targetSection);
      dropTarget = { token: targetToken, before };
    });

    list.addEventListener("drop", (event) => {
      if (layoutLocked()) return;
      const draggedToken = draggedSectionToken || (draggedChatKey ? "c:" + draggedChatKey : "");
      if (!draggedToken || !dropTarget) return;
      event.preventDefault();
      const target = dropTarget;
      persistLayoutMove(draggedToken, target.token, target.before).finally(finishLayoutDrag);
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
      const project = refreshProjectInfo(false);
      sendResponse({
        title: document.title,
        url: location.href,
        state: localState.state,
        startedAt: localState.startedAt,
        finishedAt: localState.finishedAt,
        updatedAt: localState.updatedAt,
        projectKnown: project.known === true,
        projectKey: project.key || "",
        projectName: project.name || ""
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

    if (changes.monitorLayoutLocked && layoutLocked()) {
      dragging = null;
      resizing = null;
      panel?.classList.remove("dragging", "resizing");
      if (host) {
        host.style.pointerEvents = "none";
        host.style.cursor = "";
      }
      finishLayoutDrag();
      closeMenus();
    }

    render();
  });

  const observer = new MutationObserver(() => {
    scheduleEvaluate();
    scheduleProjectRefresh();
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
    attributeFilter: ["aria-label", "data-testid", "disabled", "role", "href", "title"]
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
    refreshProjectInfo(false);
    evaluate({ allowFallback: true });
    sendCurrentState();
    await requestSnapshot();
  })();
})();
