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
      var channelPrefix = s.id.startsWith("feishu:") ? "feishu" : s.id.startsWith("dingtalk:") ? "dingtalk" : s.id.startsWith("wechat:") ? "wechat" : s.id.startsWith("wecom:") ? "wecom" : s.id.startsWith("qq:") ? "qq" : s.id.startsWith("telegram:") ? "telegram" : s.id.startsWith("imessage:") ? "imessage" : s.id.startsWith("whatsapp:") ? "whatsapp" : null;
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
    handleSlashMenu();
  });

  // --- Slash command autocomplete ---
  var slashMenu = document.getElementById("slash-menu");
  var slashSkillsCache = null;
  var slashActiveIdx = -1;

  async function fetchSkills() {
    if (slashSkillsCache) return slashSkillsCache;
    try {
      var res = await fetch("/api/skills", { credentials: "same-origin" });
      if (!res.ok) return [];
      var data = await res.json();
      slashSkillsCache = (data.skills || []).filter(function(s) { return s.userInvocable && s.userEnabled; });
      return slashSkillsCache;
    } catch(e) { return []; }
  }

  async function handleSlashMenu() {
    var text = input.value;
    if (!text.startsWith("/") || text.includes(" ") || text.includes("\\n")) {
      hideSlashMenu();
      return;
    }
    var query = text.slice(1).toLowerCase();
    var skills = await fetchSkills();
    var filtered = skills.filter(function(s) {
      return s.name.toLowerCase().includes(query);
    });
    if (!filtered.length) { hideSlashMenu(); return; }
    slashActiveIdx = 0;
    renderSlashMenu(filtered);
  }

  function renderSlashMenu(items) {
    slashMenu.innerHTML = "";
    items.forEach(function(s, i) {
      var el = document.createElement("div");
      el.className = "slash-menu-item" + (i === slashActiveIdx ? " active" : "");
      el.innerHTML = '<span class="slash-menu-item-name">/' + escHtml(s.name) + '</span>'
        + (s.description ? '<span class="slash-menu-item-desc">' + escHtml(s.description) + '</span>' : '');
      el.onmouseenter = function() {
        slashActiveIdx = i;
        slashMenu.querySelectorAll(".slash-menu-item").forEach(function(el2, j) {
          el2.classList.toggle("active", j === i);
        });
      };
      el.onclick = function(e) {
        e.preventDefault();
        selectSlashItem(s);
      };
      slashMenu.appendChild(el);
    });
    slashMenu.classList.remove("hidden");
  }

  function selectSlashItem(skill) {
    input.value = "/" + skill.name + " ";
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
    updateBtn();
    hideSlashMenu();
    input.focus();
  }

  function hideSlashMenu() {
    slashMenu.classList.add("hidden");
    slashMenu.innerHTML = "";
    slashActiveIdx = -1;
  }

  input.addEventListener("keydown", function(e) {
    if (slashMenu.classList.contains("hidden")) return;
    var items = slashMenu.querySelectorAll(".slash-menu-item");
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashActiveIdx = (slashActiveIdx + 1) % items.length;
      items.forEach(function(el, j) { el.classList.toggle("active", j === slashActiveIdx); });
      items[slashActiveIdx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      slashActiveIdx = (slashActiveIdx - 1 + items.length) % items.length;
      items.forEach(function(el, j) { el.classList.toggle("active", j === slashActiveIdx); });
      items[slashActiveIdx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      if (slashActiveIdx >= 0 && slashActiveIdx < items.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        items[slashActiveIdx].click();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideSlashMenu();
    }
  });

  document.addEventListener("click", function(e) {
    if (!slashMenu.contains(e.target) && e.target !== input) {
      hideSlashMenu();
    }
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

  // --- Context Collapse stats display (aligned with claude-code TokenWarning) ---
  var collapseStatsEl = document.getElementById("collapse-stats");
  function updateCollapseStats(data) {
    if (!collapseStatsEl) return;
    var collapsed = data.collapsedSpans || 0;
    var staged = data.stagedSpans || 0;
    var errors = data.totalErrors || 0;
    var total = collapsed + staged;
    if (total === 0 && errors === 0) {
      collapseStatsEl.style.display = "none";
      return;
    }
    collapseStatsEl.style.display = "flex";
    var text = collapsed + " / " + total + " summarized";
    if (errors > 0) {
      text += " \u00b7 errors: " + errors;
      collapseStatsEl.className = "collapse-stats has-errors";
    } else {
      collapseStatsEl.className = "collapse-stats";
    }
    collapseStatsEl.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Agent Panel — shows background agent progress (Agent-Team / Sub-Agent)
  // ---------------------------------------------------------------------------
  var agentPanel = {
    team: null,          // { name } | null
    agents: new Map(),   // agentId → { name, color, status, toolUseCount }
    collapsed: false,
  };
  // Sessions that have a pending notification_ready but were busy — deliver after done
  var pendingDelivery = new Set();

  var AGENT_COLOR_MAP = {
    blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
    red: '#ef4444', purple: '#a855f7', cyan: '#06b6d4',
    orange: '#f97316', pink: '#ec4899',
  };

  var agentPanelEl = document.getElementById("agent-panel");
  var agentPanelBody = document.getElementById("agent-panel-body");
  var agentPanelTitle = document.getElementById("agent-panel-title");
  var agentPanelCount = document.getElementById("agent-panel-count");
  var agentPanelToggle = document.getElementById("agent-panel-toggle");
  document.getElementById("agent-panel-close").onclick = function() {
    agentPanel.team = null; agentPanel.agents.clear();
    if (agentPanelEl) agentPanelEl.style.display = "none";
  };
  document.getElementById("agent-panel-header").onclick = function(e) {
    if (e.target === document.getElementById("agent-panel-close")) return;
    agentPanel.collapsed = !agentPanel.collapsed;
    if (agentPanelEl) agentPanelEl.classList.toggle("collapsed", agentPanel.collapsed);
  };

  function renderAgentPanel() {
    if (!agentPanelEl) return;
    var runningCount = 0;
    agentPanel.agents.forEach(function(a) { if (a.status === "running") runningCount++; });
    if (!agentPanel.team && agentPanel.agents.size === 0) {
      agentPanelEl.style.display = "none"; return;
    }
    agentPanelEl.style.display = "";
    if (agentPanelTitle) agentPanelTitle.textContent = agentPanel.team ? agentPanel.team.name : "Agents";
    if (agentPanelCount) agentPanelCount.textContent = runningCount > 0 ? runningCount + " running" : agentPanel.agents.size + " agent(s)";
    if (!agentPanelBody) return;
    agentPanelBody.innerHTML = "";
    agentPanel.agents.forEach(function(agent, id) {
      var row = document.createElement("div");
      row.className = "agent-row";
      var dot = document.createElement("span");
      dot.className = "agent-dot" + (agent.status === "running" ? " running" : "");
      var color = AGENT_COLOR_MAP[agent.color] || AGENT_COLOR_MAP.blue;
      dot.style.background = color;
      dot.style.borderColor = color;
      var name = document.createElement("span");
      name.className = "agent-name";
      name.textContent = agent.name;
      var status = document.createElement("span");
      status.className = "agent-status";
      if (agent.status === "running") {
        status.textContent = "running · " + agent.toolUseCount + " tool call" + (agent.toolUseCount === 1 ? "" : "s");
      } else if (agent.status === "completed") {
        status.textContent = "done";
      } else if (agent.status === "failed") {
        status.textContent = "failed";
      } else {
        status.textContent = "idle";
      }
      row.appendChild(dot); row.appendChild(name); row.appendChild(status);
      agentPanelBody.appendChild(row);
    });
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
      if (data.type === "config_updated") { slashSkillsCache = null; showConfigNotification(); return; }
      if (data.type === "channel_message") {
        loadSessionList();
        // If currently viewing this session, append the message directly
        if (data.sessionKey && currentSessionId === data.sessionKey) {
          appendMsg(data.role === "user" ? "user" : "assistant", data.text);
          hideWelcome();
        }
        return;
      }
      if (data.type === "context_collapse") { updateCollapseStats(data); return; }
      if (data.type === "notification_ready") {
        // Server says a background agent completed and enqueued a notification.
        // Auto-deliver unless we're currently processing a user message.
        var sk = data.sessionKey;
        if (!busy) {
          if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "deliver_notifications", sessionKey: sk }));
        } else {
          pendingDelivery.add(sk);
        }
        return;
      }
      if (data.type === "team_created") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        agentPanel.team = { name: data.teamName };
        renderAgentPanel();
        return;
      }
      if (data.type === "teammate_spawned") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        agentPanel.agents.set(data.agentId, { name: data.name, color: data.color || "blue", status: "idle", toolUseCount: 0 });
        renderAgentPanel();
        return;
      }
      if (data.type === "agent_progress") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        var ag = agentPanel.agents.get(data.agentId);
        if (ag) { ag.status = "running"; ag.toolUseCount = data.toolUseCount; }
        renderAgentPanel();
        return;
      }
      if (data.type === "agent_done") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        var ag2 = agentPanel.agents.get(data.agentId);
        if (ag2) { ag2.status = data.status; }
        renderAgentPanel();
        // Auto-remove after 5s
        setTimeout(function() { agentPanel.agents.delete(data.agentId); renderAgentPanel(); }, 5000);
        return;
      }
      if (data.type === "session_lifecycle") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        if (data.event === "requesting") {
          showThinking();
          return;
        }
        if (data.event === "done") {
          if (isStreaming) { finalizeStreamingMessage(""); }
          finalizeThinking(); finalizeToolContainer();
          busy = false; updateBtn();
          // Drain any pending notification deliveries
          if (pendingDelivery.size > 0) {
            var toDeliver = Array.from(pendingDelivery);
            pendingDelivery.clear();
            toDeliver.forEach(function(sk2) {
              if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "deliver_notifications", sessionKey: sk2 }));
            });
          }
          return;
        }
        if (data.event === "compact") {
          appendSystemNotice(tt("compacted") || "Context compacted");
          return;
        }
        return;
      }
      if (data.type === "session_event") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        if (data.event && data.event.type === "api_retry") {
          var retryMsg = "API retry " + data.event.attempt + "/" + data.event.maxRetries + ": " + (data.event.error || "");
          appendSystemNotice(retryMsg);
          return;
        }
        if (data.event && data.event.type === "tombstone") {
          // Remove message by uuid (future: implement message-level uuid tracking)
          return;
        }
        return;
      }
      if (data.type === "mcp_auth_url") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        // Auto-open MCP OAuth authorization URL in a new tab
        window.open(data.url, "_blank");
        appendSystemNotice("🔑 " + (data.serverName || "MCP") + " authorization opened in new tab");
        return;
      }
      if (data.type === "permission_request") {
        if (data.sessionId && data.sessionId !== currentSessionId) return;
        showPermissionDialog(data);
        return;
      }
      if (data.sessionId && data.sessionId !== currentSessionId) return;
      if (data.type === "tool") { handleToolEvent(data.data); return; }
      if (data.type === "file") { appendFileCard(data.name, data.url); return; }
      if (data.type === "stream") { handleStreamChunk(data.chunk); return; }
      if (data.type === "thinking") { showThinking(data.chunk); return; }
      // Ignore known non-display events that should NOT clear thinking state
      if (data.type === "session_runtime" || data.type === "ping" || data.type === "config_updated") return;
      if (!isStreaming) { finalizeThinking(); finalizeToolContainer(); }
      if (data.type === "message") {
        // If streaming was already finalized by "done" signal, skip to avoid duplicate
        if (isStreaming) { finalizeStreamingMessage(data.text); }
        else if (!document.querySelector('.msg-row.assistant:last-child .msg')?.textContent) {
          appendMsg("assistant", data.text);
        }
        busy = false; updateBtn();
      }
      else if (data.type === "merged") { if (isStreaming) { finalizeStreamingMessage(""); } busy = false; updateBtn(); }
      else if (data.type === "error") { if (isStreaming) { finalizeStreamingMessage(""); } appendErrorMsg(data.message); busy = false; updateBtn(); }
    };
  }
  connectWs();

  // ---------------------------------------------------------------------------
  // Permission approval dialog
  // ---------------------------------------------------------------------------

  var pendingPermissions = new Map(); // requestId → element

  function showPermissionDialog(data) {
    var container = getOrCreateToolContainer();
    var card = document.createElement("div");
    card.className = "permission-card";
    card.id = "perm-" + data.requestId;

    // Tool name display
    var toolName = data.toolName || "Unknown";
    var headerHtml = '<div class="permission-header">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
      + '<span class="permission-title">' + escHtml(toolName) + '</span>'
      + '</div>';

    // Message
    var msgHtml = '<div class="permission-message">' + escHtml(data.message || "This tool requires your approval.") + '</div>';

    // Input preview (collapsible)
    var inputHtml = '';
    if (data.toolInput && Object.keys(data.toolInput).length > 0) {
      var inputStr = JSON.stringify(data.toolInput, null, 2);
      if (inputStr.length > 500) inputStr = inputStr.slice(0, 500) + "\\n...";
      inputHtml = '<details class="permission-input-details"><summary>' + tt("show_input") + '</summary>'
        + '<pre class="permission-input-preview">' + escHtml(inputStr) + '</pre></details>';
    }

    // Suggestions (e.g. "Always Allow Bash", "Always Allow Read")
    var suggestionsHtml = '';
    var suggestions = data.suggestions || [];
    if (suggestions.length > 0) {
      suggestionsHtml = '<div class="permission-suggestions">';
      for (var si = 0; si < suggestions.length; si++) {
        var sug = suggestions[si];
        var sugLabel = "";
        if (sug.type === "addRules" && sug.rules && sug.rules.length > 0) {
          var ruleNames = sug.rules.map(function(r) { return r.toolName + (r.ruleContent ? "(" + r.ruleContent + ")" : ""); });
          sugLabel = (sug.behavior === "allow" ? tt("always_allow") : sug.behavior === "deny" ? tt("always_deny") : tt("always_ask")) + ": " + ruleNames.join(", ");
        } else {
          sugLabel = JSON.stringify(sug);
        }
        suggestionsHtml += '<label class="permission-suggestion"><input type="checkbox" data-sug-idx="' + si + '"> ' + escHtml(sugLabel) + '</label>';
      }
      suggestionsHtml += '</div>';
    }

    // Buttons
    var actionsHtml = '<div class="permission-actions">'
      + '<button class="permission-btn permission-btn-allow">' + tt("allow") + '</button>'
      + '<button class="permission-btn permission-btn-deny">' + tt("deny") + '</button>'
      + '</div>';

    // Timer
    var timerHtml = '<div class="permission-timer"><span class="permission-timer-text">120s</span></div>';

    card.innerHTML = headerHtml + msgHtml + inputHtml + suggestionsHtml + actionsHtml + timerHtml;
    container.appendChild(card);
    scrollBottom();

    var requestId = data.requestId;
    var timerSpan = card.querySelector(".permission-timer-text");
    var remaining = 120;
    var countdown = setInterval(function() {
      remaining--;
      if (timerSpan) timerSpan.textContent = remaining + "s";
      if (remaining <= 0) {
        clearInterval(countdown);
        resolvePermission(requestId, "deny");
      }
    }, 1000);

    pendingPermissions.set(requestId, { card: card, countdown: countdown, suggestions: suggestions });

    // Button handlers
    var allowBtn = card.querySelector(".permission-btn-allow");
    var denyBtn = card.querySelector(".permission-btn-deny");
    if (allowBtn) allowBtn.onclick = function() { resolvePermission(requestId, "allow"); };
    if (denyBtn) denyBtn.onclick = function() { resolvePermission(requestId, "deny"); };
  }

  function resolvePermission(requestId, decision) {
    var entry = pendingPermissions.get(requestId);
    if (!entry) return;
    clearInterval(entry.countdown);
    pendingPermissions.delete(requestId);

    // Collect accepted suggestion indices
    var acceptedIndices = [];
    var card = entry.card;
    if (decision === "allow" && entry.suggestions && entry.suggestions.length > 0) {
      var checkboxes = card.querySelectorAll('.permission-suggestion input[type="checkbox"]');
      checkboxes.forEach(function(cb) {
        if (cb.checked) {
          acceptedIndices.push(parseInt(cb.dataset.sugIdx, 10));
        }
      });
    }

    // Send response to server
    var payload = { type: "permission_response", requestId: requestId, decision: decision };
    if (acceptedIndices.length > 0) payload.acceptedSuggestionIndices = acceptedIndices;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }

    // Update card UI
    var actions = card.querySelector(".permission-actions");
    var timer = card.querySelector(".permission-timer");
    var sugBox = card.querySelector(".permission-suggestions");
    if (actions) actions.remove();
    if (timer) timer.remove();
    if (sugBox) sugBox.remove();

    var badge = document.createElement("div");
    badge.className = "permission-result " + (decision === "allow" ? "permission-allowed" : "permission-denied");
    var badgeText = decision === "allow" ? (tt("allowed") || "Allowed") : (tt("denied") || "Denied");
    if (acceptedIndices.length > 0) badgeText += " (" + tt("rules_saved") + ")";
    badge.textContent = badgeText;
    card.appendChild(badge);
    card.classList.add("permission-resolved");
  }

`;
}
