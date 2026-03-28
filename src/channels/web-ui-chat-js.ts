/** Chat UI: welcome state, session management, WebSocket connection. */

export function getChatMainJs(): string {
  return `
  // --- Welcome state ---
  function getGreeting() {
    var h = new Date().getHours();
    if (h < 12) return tt("welcome_morning");
    if (h < 18) return tt("welcome_afternoon");
    return tt("welcome_evening");
  }
  function renderWelcome() {
    document.getElementById("welcome-greeting").textContent = getGreeting();
    var chipsEl = document.getElementById("welcome-chips");
    chipsEl.innerHTML = "";
    var chipKeys = ["chip_write", "chip_code", "chip_explain", "chip_brainstorm"];
    chipKeys.forEach(function(key) {
      var chip = document.createElement("button");
      chip.className = "welcome-chip";
      chip.textContent = tt(key);
      chip.onclick = function() {
        input.value = chip.textContent;
        input.dispatchEvent(new Event("input"));
        input.focus();
      };
      chipsEl.appendChild(chip);
    });
  }
  function showWelcome() {
    welcomeEl.classList.remove("hidden");
    msgs.classList.remove("active");
  }
  function hideWelcome() {
    welcomeEl.classList.add("hidden");
    msgs.classList.add("active");
  }
  renderWelcome();
  i18nCallbacks.push(renderWelcome);

  // --- Session management ---
  var SP = "klaus_" + currentUser.id.slice(0, 8);
  var sessionsMeta = [];
  var currentSessionId = localStorage.getItem(SP + "_c") || null;
  var sessionDom = new Map();
  var prevSessionId = null;

  // Start with empty list, server is source of truth
  if (!currentSessionId) {
    currentSessionId = crypto.randomUUID();
    sessionsMeta.unshift({ id: currentSessionId, title: "New Chat", ts: Date.now() });
  }
  saveSessionMeta();

  i18nCallbacks.push(function() { renderSessionList(); });
  applyI18n();

  renderSessionList();

  async function loadSessionList() {
    try {
      var res = await fetch("/api/sessions", { credentials: "same-origin" });
      if (!res.ok) return;
      var data = await res.json();
      if (!data.sessions || !Array.isArray(data.sessions)) return;
      // Server is source of truth: rebuild list from server data
      var serverMap = {};
      data.sessions.forEach(function(srv) {
        serverMap[srv.sessionId] = { id: srv.sessionId, title: srv.title, ts: srv.updatedAt };
      });
      // Keep current "New Chat" if it's not on server yet
      var newList = [];
      var currentInServer = !!serverMap[currentSessionId];
      if (!currentInServer) {
        var cur = sessionsMeta.find(function(s) { return s.id === currentSessionId; });
        if (cur) newList.push(cur);
      }
      // Add all server sessions sorted by time
      var srvList = data.sessions.map(function(srv) {
        return { id: srv.sessionId, title: srv.title, ts: srv.updatedAt };
      });
      srvList.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
      srvList.forEach(function(s) { newList.push(s); });
      sessionsMeta = newList;
      // If current session not in list, select the first one
      if (!sessionsMeta.find(function(s) { return s.id === currentSessionId; })) {
        if (sessionsMeta.length > 0) {
          currentSessionId = sessionsMeta[0].id;
        } else {
          currentSessionId = crypto.randomUUID();
          sessionsMeta.unshift({ id: currentSessionId, title: "New Chat", ts: Date.now() });
        }
      }
      saveSessionMeta();
      renderSessionList();
    } catch(e) {
      console.warn("Failed to load session list:", e);
    }
  }
  loadSessionList();

  function saveSessionMeta() {
    localStorage.setItem(SP + "_c", currentSessionId);
  }

  function createNewChat() {
    var frag = document.createDocumentFragment();
    while (msgs.firstChild) frag.appendChild(msgs.firstChild);
    if (frag.childNodes.length) sessionDom.set(currentSessionId, frag);
    prevSessionId = currentSessionId;
    currentSessionId = crypto.randomUUID();
    sessionsMeta.unshift({ id: currentSessionId, title: "New Chat", ts: Date.now() });
    saveSessionMeta();
    busy = false; isStreaming = false; streamBuffer = ""; streamFullText = "";
    if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
    activeTools.clear(); agentContainers.clear(); toolContainer = null;
    updateBtn(); renderSessionList(); closeSidebar();
    showWelcome();
  }

  function switchSession(id) {
    if (id === currentSessionId) { closeSidebar(); return; }
    var frag = document.createDocumentFragment();
    while (msgs.firstChild) frag.appendChild(msgs.firstChild);
    if (frag.childNodes.length) sessionDom.set(currentSessionId, frag);
    prevSessionId = currentSessionId;
    currentSessionId = id;
    var saved = sessionDom.get(id);
    if (saved) {
      msgs.appendChild(saved); sessionDom.delete(id);
      hideWelcome();
    } else {
      loadHistory(id);
    }
    busy = false; isStreaming = false; streamBuffer = ""; streamFullText = "";
    if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
    activeTools.clear(); agentContainers.clear(); toolContainer = null;
    updateBtn(); saveSessionMeta(); renderSessionList(); closeSidebar(); scrollBottom();
  }

  function deleteSession(id, evt) {
    if (evt) { evt.stopPropagation(); evt.preventDefault(); }
    sessionsMeta = sessionsMeta.filter(function(s){ return s.id !== id; });
    sessionDom.delete(id);
    historyLoaded.delete(id);
    if (id === currentSessionId) {
      while (msgs.firstChild) msgs.removeChild(msgs.firstChild);
      activeTools.clear(); agentContainers.clear(); toolContainer = null;
      if (!sessionsMeta.length) { createNewChat(); return; }
      currentSessionId = sessionsMeta[0].id;
      var saved = sessionDom.get(currentSessionId);
      if (saved) { msgs.appendChild(saved); sessionDom.delete(currentSessionId); hideWelcome(); }
      else { loadHistory(currentSessionId); }
    }
    saveSessionMeta(); renderSessionList();
    fetch("/api/sessions?sessionId=" + encodeURIComponent(id), { method: "DELETE", credentials: "same-origin" }).catch(function() {});
  }

  function updateSessionTitle(text) {
    var s = sessionsMeta.find(function(s){ return s.id === currentSessionId; });
    if (s && s.title === "New Chat" && text) {
      s.title = text.slice(0, 40);
      s.ts = Date.now();
      saveSessionMeta(); renderSessionList();
    }
  }

  function renderSessionList() {
    sessionListEl.innerHTML = "";
    sessionsMeta.forEach(function(s) {
      var el = document.createElement("div");
      el.className = "session-item" + (s.id === currentSessionId ? " active" : "");
      var icon = document.createElement("span");
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      icon.style.cssText = "flex-shrink:0;color:var(--fg-quaternary);display:flex";
      // Channel badge for non-web sessions
      var channelPrefix = s.id.startsWith("feishu:") ? "feishu" : s.id.startsWith("dingtalk:") ? "dingtalk" : s.id.startsWith("wechat:") ? "wechat" : s.id.startsWith("wecom:") ? "wecom" : s.id.startsWith("qq:") ? "qq" : s.id.startsWith("telegram:") ? "telegram" : null;
      if (channelPrefix) {
        var badge = document.createElement("span");
        badge.className = "s-channel-badge";
        badge.textContent = tt("settings_ch_" + channelPrefix);
        el.appendChild(badge);
      }
      var title = document.createElement("span");
      title.className = "s-title";
      title.textContent = (!s.title || s.title === "New Chat") ? tt("new_chat_title") : s.title;
      var del = document.createElement("button");
      del.className = "s-del";
      del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      del.title = tt("delete_title");
      del.onclick = function(e) { deleteSession(s.id, e); };
      el.appendChild(icon);
      el.appendChild(title);
      el.appendChild(del);
      el.onclick = function() { switchSession(s.id); };
      sessionListEl.appendChild(el);
    });
  }

  function openSidebar() { sidebar.classList.add("open"); sidebarOverlay.classList.add("show"); loadSessionList(); }
  function closeSidebar() { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("show"); }
  menuBtn.addEventListener("click", function() { sidebar.classList.contains("open") ? closeSidebar() : openSidebar(); });
  sidebarOverlay.addEventListener("click", closeSidebar);
  newChatBtn.addEventListener("click", createNewChat);

  var pendingFiles = [];

  input.addEventListener("input", function(){
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 200) + "px";
    updateBtn();
  });

  var ws = null;
  var reconnectAttempt = 0;
  var historyLoaded = new Set();
  var pendingRpc = new Map();
  var rpcSeq = 0;

  var RPC_LONG_METHODS = { "chat.send": 1, "voice.send": 1, "cron.run": 1 };
  function rpc(method, params) {
    return new Promise(function(resolve, reject) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("ws unavailable"));
        return;
      }
      var id = "rpc-" + (++rpcSeq) + "-" + Date.now().toString(36);
      var timeout = RPC_LONG_METHODS[method] ? 300000 : 10000;
      var timer = setTimeout(function() {
        pendingRpc.delete(id);
        reject(new Error("rpc timeout"));
      }, timeout);
      pendingRpc.set(id, { resolve: resolve, reject: reject, timer: timer });
      ws.send(JSON.stringify({ type: "rpc", id: id, method: method, params: params || {} }));
    });
  }

  async function loadHistory(sessionId) {
    if (historyLoaded.has(sessionId)) return;
    historyLoaded.add(sessionId);
    try {
      var res = await fetch("/api/history?sessionId=" + encodeURIComponent(sessionId), { credentials: "same-origin" });
      if (!res.ok) { historyLoaded.delete(sessionId); return; }
      var data = await res.json();
      if (!data.messages || !data.messages.length) {
        if (sessionId === currentSessionId) showWelcome();
        return;
      }
      if (sessionId !== currentSessionId) return;
      hideWelcome();
      data.messages.forEach(function(m) {
        appendMsg(m.role === "user" ? "user" : "assistant", m.content);
      });
    } catch(e) {
      historyLoaded.delete(sessionId);
      console.warn("Failed to load history:", e);
    }
  }

  function connectWs() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/api/ws");
    ws.onopen = function() {
      reconnectAttempt = 0;
      statusEl.textContent = tt("connected");
      statusEl.setAttribute("data-i18n", "connected");
      statusEl.className = "";
      if (!msgs.firstChild && !sessionDom.has(currentSessionId)) {
        loadHistory(currentSessionId);
      }
      refreshSessionActivity(currentSessionId);
      // If we were streaming when WS dropped, the final message event was lost.
      // Reload full history from server to recover.
      if (isStreaming || busy) {
        if (isStreaming) finalizeStreamingMessage("");
        removeThinking(); clearToolContainer();
        busy = false; updateBtn();
        // Clear DOM and reload from server
        while (msgs.firstChild) msgs.removeChild(msgs.firstChild);
        historyLoaded.delete(currentSessionId);
        loadHistory(currentSessionId);
      }
    };
    ws.onclose = function() {
      ws = null;
      pendingRpc.forEach(function(entry) {
        clearTimeout(entry.timer);
        entry.reject(new Error("ws closed"));
      });
      pendingRpc.clear();
      statusEl.textContent = tt("reconnecting");
      statusEl.setAttribute("data-i18n", "reconnecting");
      statusEl.className = "disconnected";
      var base = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
      var delay = Math.round(base + base * 0.2 * Math.random());
      reconnectAttempt++;
      setTimeout(connectWs, delay);
    };
    ws.onerror = function() {};
    ws.onmessage = function(e) {
      var data;
      try { data = JSON.parse(e.data); } catch(_) { return; }
      if (data.type === "rpc-response") {
        var pending = pendingRpc.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingRpc.delete(data.id);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.result);
        return;
      }
      if (data.type === "ping") return;
      if (data.type === "config_updated") { showConfigNotification(); return; }
      if (data.type === "channel_message") {
        loadSessionList();
        // If currently viewing this session, append the message directly
        if (data.sessionKey && currentSessionId === data.sessionKey) {
          appendMsg(data.role === "user" ? "user" : "assistant", data.text);
          hideWelcome();
        }
        return;
      }
      if (data.sessionId && data.sessionId !== currentSessionId) return;
      if (data.type === "tool") { handleToolEvent(data.data); return; }
      if (data.type === "file") { appendFileCard(data.name, data.url); return; }
      if (data.type === "stream") { handleStreamChunk(data.chunk); return; }
      if (data.type === "thinking") { showThinking(); return; }
      if (!isStreaming) { removeThinking(); clearToolContainer(); }
      if (data.type === "message") {
        if (isStreaming) { finalizeStreamingMessage(data.text); }
        else { appendMsg("assistant", data.text); }
        busy = false; updateBtn();
      }
      else if (data.type === "merged") { if (isStreaming) { finalizeStreamingMessage(""); } busy = false; updateBtn(); }
      else if (data.type === "error") { if (isStreaming) { finalizeStreamingMessage(""); } appendErrorMsg(data.message); busy = false; updateBtn(); }
    };
  }
  connectWs();

`;
}
