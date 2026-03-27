/** Chat UI settings panel JavaScript (tabs, MCP, Cron, Channels). */

export function getSettingsJs(): string {
  return `
  // --- Settings tab switching ---
  var sNavItems = document.querySelectorAll(".settings-nav-item[data-stab]");
  var sTabPanels = document.querySelectorAll(".settings-tab-panel");
  function switchSettingsTab(id) {
    sNavItems.forEach(function(n) { n.classList.toggle("active", n.getAttribute("data-stab") === id); });
    sTabPanels.forEach(function(p) { p.classList.toggle("active", p.id === "stab-" + id); });
    if (id === "mcp" && isAdmin) loadMcpServers();
    if (id === "cron" && isAdmin) loadCronTasks();
    if (id === "channels") loadSettingsChannels();
  }
  sNavItems.forEach(function(b) { b.addEventListener("click", function() { switchSettingsTab(b.getAttribute("data-stab")); }); });

  function showSettings() {
    adminView.style.display = "none";
    settingsView.style.display = "block";
    chatElements.forEach(function(el) { if (el) el.style.display = "none"; });
    // Populate profile
    var initial = (currentUser.name || currentUser.email || "U").charAt(0).toUpperCase();
    var sAvatar = document.getElementById("settings-avatar");
    var existingImg = sAvatar.querySelector("img");
    if (currentUser.avatar) {
      if (existingImg) { existingImg.src = currentUser.avatar; }
      else { sAvatar.insertAdjacentHTML("afterbegin", '<img src="' + currentUser.avatar + '" alt="">'); }
      sAvatar.childNodes.forEach(function(n) { if (n.nodeType === 3) n.remove(); });
    } else {
      if (existingImg) existingImg.remove();
      var hasText = false;
      sAvatar.childNodes.forEach(function(n) { if (n.nodeType === 3) hasText = true; });
      if (!hasText) sAvatar.insertAdjacentText("afterbegin", initial);
      else sAvatar.firstChild.textContent = initial;
    }
    document.getElementById("settings-profile-name").textContent = currentUser.name || currentUser.email || "";
    document.getElementById("settings-profile-email").textContent = currentUser.email || "";
    document.getElementById("settings-input-name").value = currentUser.name || "";
    // Theme
    var curTheme = localStorage.getItem("klaus_theme") || "auto";
    document.querySelectorAll(".settings-theme-card").forEach(function(c) {
      c.classList.toggle("active", c.getAttribute("data-theme") === curTheme);
    });
    // Show/hide admin-only tabs
    var mcpNav = document.querySelector("[data-stab='mcp']");
    var cronNav = document.querySelector("[data-stab='cron']");
    if (isAdmin) {
      if (mcpNav) mcpNav.style.display = "";
      if (cronNav) cronNav.style.display = "";
    } else {
      if (mcpNav) mcpNav.style.display = "none";
      if (cronNav) cronNav.style.display = "none";
    }
  }
  function hideSettings() {
    settingsView.style.display = "none";
    chatElements.forEach(function(el) { if (el) el.style.display = ""; });
  }

  document.getElementById("settings-back").addEventListener("click", hideSettings);

  // Save profile
  document.getElementById("settings-btn-save").addEventListener("click", function() {
    var btn = this;
    var name = document.getElementById("settings-input-name").value.trim();
    var status = document.getElementById("settings-save-status");
    btn.disabled = true; status.textContent = "";
    fetch("/api/auth/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify({ displayName: name })
    }).then(function(r) {
      if (!r.ok) throw new Error();
      status.textContent = tt("settings_saved");
      currentUser.name = name;
      document.getElementById("settings-profile-name").textContent = name || currentUser.email;
      usernameEl.textContent = name || currentUser.email || "User";
      var ini = (name || currentUser.email || "U").charAt(0).toUpperCase();
      document.getElementById("sidebar-avatar").textContent = ini;
      setTimeout(function() { status.textContent = ""; }, 2000);
    }).catch(function() {
      status.textContent = "Error"; status.style.color = "#dc2626";
      setTimeout(function() { status.textContent = ""; status.style.color = ""; }, 2000);
    }).finally(function() { btn.disabled = false; });
  });

  // Avatar upload
  var settingsAvatarEl = document.getElementById("settings-avatar");
  var avatarInput = document.getElementById("settings-avatar-input");
  settingsAvatarEl.addEventListener("click", function() { avatarInput.click(); });
  avatarInput.addEventListener("change", function() {
    var file = avatarInput.files[0];
    if (!file) return;
    fetch("/api/auth/avatar", {
      method: "POST",
      headers: { "Content-Type": file.type },
      credentials: "same-origin",
      body: file
    }).then(function(r) {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(function(data) {
      var url = data.user.avatarUrl;
      currentUser.avatar = url;
      settingsAvatarEl.querySelector("img") ?
        settingsAvatarEl.querySelector("img").src = url + "?t=" + Date.now() :
        settingsAvatarEl.insertAdjacentHTML("afterbegin", '<img src="' + url + '" alt="">');
      avatarEl.innerHTML = '<img src="' + url + '?t=' + Date.now() + '" alt="">';
    }).catch(function() {
      var status = document.getElementById("settings-save-status");
      status.textContent = "Upload failed"; status.style.color = "#dc2626";
      setTimeout(function() { status.textContent = ""; status.style.color = ""; }, 2000);
    });
    avatarInput.value = "";
  });

  // Theme
  document.getElementById("settings-theme-options").addEventListener("click", function(e) {
    var card = e.target.closest(".settings-theme-card");
    if (!card) return;
    var theme = card.getAttribute("data-theme");
    localStorage.setItem("klaus_theme", theme);
    document.querySelectorAll(".settings-theme-card").forEach(function(c) {
      c.classList.toggle("active", c.getAttribute("data-theme") === theme);
    });
    applyTheme(theme);
    notifyIframes({ type: "klaus-settings", theme: theme });
  });

  // --- Toast ---
  var sToastEl = document.getElementById("s-toast"), sToastTimer;
  function showSettingsToast(msg) { sToastEl.textContent = msg; sToastEl.classList.add("show"); clearTimeout(sToastTimer); sToastTimer = setTimeout(function() { sToastEl.classList.remove("show"); }, 2000); }
  function escS(s) { if (s == null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function adminApi(path, method, params) {
    var qs = "";
    var opts = { method: method || "GET", credentials: "same-origin" };
    if (method === "POST" || method === "PATCH") {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(params || {});
    } else if (params) {
      var pairs = [];
      Object.keys(params).forEach(function(k) { pairs.push(k + "=" + encodeURIComponent(params[k])); });
      qs = pairs.join("&");
    }
    var url = "/api/admin/" + path + (qs ? "?" + qs : "");
    return fetch(url, opts).then(function(r) { if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.json(); });
  }

  // =====================================================
  // MCP SERVERS (in settings)
  // =====================================================
  var sMcpWrap = document.getElementById("s-mcp-wrap");
  var sMcpEmpty = document.getElementById("s-mcp-empty");
  var sMcpForm = document.getElementById("s-mcp-form");
  var sMcpAddBtn = document.getElementById("s-mcp-add-btn");
  var sMcpfId = document.getElementById("s-mcpf-id");
  var sMcpfName = document.getElementById("s-mcpf-name");
  var sMcpfType = document.getElementById("s-mcpf-type");
  var sMcpfCommand = document.getElementById("s-mcpf-command");
  var sMcpfArgs = document.getElementById("s-mcpf-args");
  var sMcpfUrl = document.getElementById("s-mcpf-url");
  var sMcpfStdio = document.getElementById("s-mcpf-stdio-fields");
  var sMcpfSse = document.getElementById("s-mcpf-sse-fields");
  var sMcpfSave = document.getElementById("s-mcpf-save");
  var sMcpfCancel = document.getElementById("s-mcpf-cancel");
  var editingMcpId = null;

  sMcpfType.addEventListener("change", function() {
    sMcpfStdio.style.display = sMcpfType.value === "stdio" ? "" : "none";
    sMcpfSse.style.display = sMcpfType.value === "sse" ? "" : "none";
  });

  function loadMcpServers() {
    adminApi("mcp", "GET").then(function(d) {
      var servers = d.servers || [];
      if (!servers.length) { sMcpWrap.innerHTML = ""; sMcpEmpty.style.display = "block"; return; }
      sMcpEmpty.style.display = "none";
      var h = "<table class='s-table'><thead><tr><th>ID</th><th>" + tt("settings_mcp_name") + "</th><th>" + tt("settings_mcp_type") + "</th><th>Detail</th><th>Status</th><th></th></tr></thead><tbody>";
      servers.forEach(function(s) {
        var badge = s.enabled
          ? "<span class='s-badge s-badge-green'>" + tt("settings_enabled") + "</span>"
          : "<span class='s-badge s-badge-gray'>" + tt("settings_disabled") + "</span>";
        var detail = s.transport.type === "stdio" ? escS(s.transport.command || "") : escS(s.transport.url || "");
        h += "<tr>"
          + "<td><span class='s-code'>" + escS(s.id) + "</span></td>"
          + "<td>" + escS(s.name) + "</td>"
          + "<td>" + escS(s.transport.type) + "</td>"
          + "<td class='s-muted'>" + detail + "</td>"
          + "<td>" + badge + "</td>"
          + "<td><div class='s-actions'>"
          + "<button class='s-btn s-btn-ghost' data-togglemcp='" + escS(s.id) + "' data-enabled='" + (s.enabled ? "1" : "0") + "'>" + (s.enabled ? "Disable" : "Enable") + "</button>"
          + "<button class='s-btn s-btn-ghost' data-editmcp='" + escS(s.id) + "'>Edit</button>"
          + "<button class='s-btn s-btn-danger' data-delmcp='" + escS(s.id) + "'>" + tt("delete_title") + "</button>"
          + "</div></td></tr>";
      });
      h += "</tbody></table>";
      sMcpWrap.innerHTML = h;
    });
  }

  sMcpAddBtn.onclick = function() {
    editingMcpId = null;
    sMcpfId.value = ""; sMcpfName.value = ""; sMcpfType.value = "stdio";
    sMcpfCommand.value = ""; sMcpfArgs.value = ""; sMcpfUrl.value = "";
    sMcpfId.disabled = false;
    sMcpfStdio.style.display = ""; sMcpfSse.style.display = "none";
    sMcpForm.style.display = "block";
    sMcpfId.focus();
  };
  sMcpfCancel.onclick = function() { sMcpForm.style.display = "none"; };

  sMcpfSave.onclick = function() {
    var id = sMcpfId.value.trim();
    if (!id) return;
    sMcpfSave.disabled = true;
    var transport;
    if (sMcpfType.value === "stdio") {
      var cmd = sMcpfCommand.value.trim();
      if (!cmd) { sMcpfSave.disabled = false; return; }
      var parts = cmd.split(/\s+/);
      var argsStr = sMcpfArgs.value.trim();
      var args = parts.slice(1);
      if (argsStr) args = args.concat(argsStr.split(",").map(function(a) { return a.trim(); }).filter(Boolean));
      transport = { type: "stdio", command: parts[0], args: args.length ? args : undefined };
    } else {
      var url = sMcpfUrl.value.trim();
      if (!url) { sMcpfSave.disabled = false; return; }
      transport = { type: "sse", url: url };
    }
    var payload = { id: id, name: sMcpfName.value.trim() || id, transport: transport, enabled: true };
    var method = editingMcpId ? "PATCH" : "POST";
    var path = editingMcpId ? "mcp?id=" + encodeURIComponent(editingMcpId) : "mcp";
    adminApi(path, method, payload)
      .then(function() { sMcpForm.style.display = "none"; showSettingsToast(tt("settings_saved")); loadMcpServers(); })
      .catch(function() { showSettingsToast(tt("settings_failed")); })
      .finally(function() { sMcpfSave.disabled = false; });
  };

  sMcpWrap.addEventListener("click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.delmcp) {
      if (!confirm(tt("settings_mcp_delete_confirm"))) return;
      adminApi("mcp?id=" + encodeURIComponent(btn.dataset.delmcp), "DELETE").then(function() { loadMcpServers(); showSettingsToast(tt("settings_deleted")); });
    } else if (btn.dataset.togglemcp) {
      var enabled = btn.dataset.enabled === "1";
      adminApi("mcp?id=" + encodeURIComponent(btn.dataset.togglemcp), "PATCH", { enabled: !enabled }).then(function() { loadMcpServers(); });
    } else if (btn.dataset.editmcp) {
      var sid = btn.dataset.editmcp;
      adminApi("mcp", "GET").then(function(d) {
        var s = (d.servers || []).find(function(x) { return x.id === sid; });
        if (!s) return;
        editingMcpId = sid;
        sMcpfId.value = s.id; sMcpfId.disabled = true;
        sMcpfName.value = s.name || "";
        sMcpfType.value = s.transport.type || "stdio";
        if (s.transport.type === "stdio") {
          var fullCmd = s.transport.command || "";
          if (s.transport.args && s.transport.args.length) fullCmd += " " + s.transport.args.join(" ");
          sMcpfCommand.value = fullCmd;
          sMcpfArgs.value = "";
          sMcpfStdio.style.display = ""; sMcpfSse.style.display = "none";
        } else {
          sMcpfUrl.value = s.transport.url || "";
          sMcpfStdio.style.display = "none"; sMcpfSse.style.display = "";
        }
        sMcpForm.style.display = "block";
      });
    }
  });

  // =====================================================
  // CRON TASKS (in settings)
  // =====================================================
  var sCronBar = document.getElementById("s-cron-scheduler-bar");
  var sCronWrap = document.getElementById("s-cron-wrap");
  var sCronEmpty = document.getElementById("s-cron-empty");
  var sCronForm = document.getElementById("s-cron-form");
  var sCronAddBtn = document.getElementById("s-cron-add-btn");
  var sCfId = document.getElementById("s-cf-id");
  var sCfName = document.getElementById("s-cf-name");
  var sCfSchedule = document.getElementById("s-cf-schedule");
  var sCfPrompt = document.getElementById("s-cf-prompt");
  var sCfSave = document.getElementById("s-cf-save");
  var sCfCancel = document.getElementById("s-cf-cancel");

  function loadCronTasks() {
    adminApi("cron/tasks", "GET").then(function(d) {
      var tasks = d.tasks || [];
      var sched = d.scheduler || {};
      var running = sched.running;
      sCronBar.innerHTML = "<span class='s-dot " + (running ? "s-dot-green" : "s-dot-red") + "'></span> "
        + "<strong>" + (running ? tt("settings_cron_running") : tt("settings_cron_stopped")) + "</strong>"
        + "<span>" + sched.taskCount + " " + tt("settings_cron_tasks_label") + "</span>"
        + "<span>" + sched.activeJobs + " " + tt("settings_cron_active_label") + "</span>"
        + (sched.nextWakeAt ? "<span>" + tt("settings_cron_next") + ": " + new Date(sched.nextWakeAt).toLocaleString() + "</span>" : "");
      if (!tasks.length) { sCronWrap.innerHTML = ""; sCronEmpty.style.display = "block"; return; }
      sCronEmpty.style.display = "none";
      var h = "<table class='s-table'><thead><tr><th>ID</th><th>" + tt("settings_cron_task_name") + "</th><th>" + tt("settings_cron_schedule") + "</th><th>Status</th><th>" + tt("settings_cron_next") + "</th><th></th></tr></thead><tbody>";
      tasks.forEach(function(t) {
        var badge = t.enabled
          ? "<span class='s-badge s-badge-green'>" + tt("settings_on") + "</span>"
          : "<span class='s-badge s-badge-gray'>" + tt("settings_off") + "</span>";
        if (t.lastRun && t.lastRun.error) badge = "<span class='s-badge s-badge-red'>Error</span>";
        h += "<tr>"
          + "<td><span class='s-code'>" + escS(t.id) + "</span></td>"
          + "<td>" + escS(t.name || "-") + "</td>"
          + "<td class='s-muted'>" + escS(t.schedule) + "</td>"
          + "<td>" + badge + "</td>"
          + "<td class='s-muted'>" + (t.nextRun ? new Date(t.nextRun).toLocaleString() : "-") + "</td>"
          + "<td><div class='s-actions'>"
          + "<button class='s-btn s-btn-ghost' data-togglecron='" + escS(t.id) + "' data-enabled='" + (t.enabled ? "1" : "0") + "'>" + (t.enabled ? "Disable" : "Enable") + "</button>"
          + "<button class='s-btn s-btn-danger' data-delcron='" + escS(t.id) + "'>" + tt("delete_title") + "</button>"
          + "</div></td></tr>";
      });
      h += "</tbody></table>";
      sCronWrap.innerHTML = h;
    });
  }

  sCronAddBtn.onclick = function() {
    sCfId.value = ""; sCfName.value = ""; sCfSchedule.value = ""; sCfPrompt.value = "";
    sCfId.disabled = false;
    sCronForm.style.display = "block";
    sCfId.focus();
  };
  sCfCancel.onclick = function() { sCronForm.style.display = "none"; };

  sCfSave.onclick = function() {
    var id = sCfId.value.trim();
    var schedule = sCfSchedule.value.trim();
    var prompt = sCfPrompt.value.trim();
    if (!id || !schedule || !prompt) return;
    sCfSave.disabled = true;
    var payload = { id: id, schedule: schedule, prompt: prompt, name: sCfName.value.trim() || undefined, enabled: true };
    adminApi("cron/tasks", "POST", payload)
      .then(function() { sCronForm.style.display = "none"; showSettingsToast(tt("settings_saved")); loadCronTasks(); })
      .catch(function() { showSettingsToast(tt("settings_failed")); })
      .finally(function() { sCfSave.disabled = false; });
  };

  sCronWrap.addEventListener("click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.togglecron) {
      var enabled = btn.dataset.enabled === "1";
      adminApi("cron/tasks?id=" + encodeURIComponent(btn.dataset.togglecron), "PATCH", { enabled: !enabled })
        .then(function() { loadCronTasks(); });
    } else if (btn.dataset.delcron) {
      if (!confirm(tt("settings_cron_delete_confirm"))) return;
      adminApi("cron/tasks?id=" + encodeURIComponent(btn.dataset.delcron), "DELETE")
        .then(function() { loadCronTasks(); showSettingsToast(tt("settings_deleted")); });
    }
  });

  // --- Settings: Channels tab ---
  var sChFeishuStatus = document.getElementById("s-ch-feishu-status");
  var sChFeishuConnected = document.getElementById("s-ch-feishu-connected");
  var sChFeishuForm = document.getElementById("s-ch-feishu-form");
  var sChFeishuSetup = document.getElementById("s-ch-feishu-setup");

  function showFeishuState(state, data) {
    sChFeishuConnected.style.display = state === "connected" ? "block" : "none";
    sChFeishuForm.style.display = state === "form" ? "block" : "none";
    sChFeishuSetup.style.display = state === "setup" ? "block" : "none";
    if (state === "connected") {
      sChFeishuStatus.textContent = tt("settings_ch_connected");
      sChFeishuStatus.className = "s-badge s-badge-green";
      document.getElementById("s-ch-feishu-appid-display").textContent = data && data.app_id || "";
      document.getElementById("s-ch-feishu-bot-display").textContent = data && data.bot_name || "-";
    } else {
      sChFeishuStatus.textContent = tt("settings_ch_not_connected");
      sChFeishuStatus.className = "s-badge s-badge-gray";
    }
  }

  function loadSettingsChannels() {
    adminApi("channels", "GET").then(function(d) {
      var feishu = d && d.feishu;
      showFeishuState(feishu && feishu.enabled ? "connected" : "setup", feishu);
    }).catch(function() {
      showFeishuState("setup", null);
    });
  }

  var FEISHU_PERMISSIONS_JSON = '{"scopes":{"tenant":["contact:contact.base:readonly","docx:document:readonly","im:chat:read","im:chat:update","im:message.group_at_msg:readonly","im:message.p2p_msg:readonly","im:message.pins:read","im:message.pins:write_only","im:message.reactions:read","im:message.reactions:write_only","im:message:readonly","im:message:recall","im:message:send_as_bot","im:message:send_multi_users","im:message:send_sys_msg","im:message:update","im:resource","application:application:self_manage","cardkit:card:write","cardkit:card:read"],"user":["contact:user.employee_id:readonly","offline_access","base:app:copy","base:field:create","base:field:delete","base:field:read","base:field:update","base:record:create","base:record:delete","base:record:retrieve","base:record:update","base:table:create","base:table:delete","base:table:read","base:table:update","base:view:read","base:view:write_only","base:app:create","base:app:update","base:app:read","board:whiteboard:node:create","board:whiteboard:node:read","calendar:calendar:read","calendar:calendar.event:create","calendar:calendar.event:delete","calendar:calendar.event:read","calendar:calendar.event:reply","calendar:calendar.event:update","calendar:calendar.free_busy:read","contact:contact.base:readonly","contact:user.base:readonly","contact:user:search","docs:document.comment:create","docs:document.comment:read","docs:document.comment:update","docs:document.media:download","docs:document:copy","docx:document:create","docx:document:readonly","docx:document:write_only","drive:drive.metadata:readonly","drive:file:download","drive:file:upload","im:chat.members:read","im:chat:read","im:message","im:message.group_msg:get_as_user","im:message.p2p_msg:get_as_user","im:message:readonly","search:docs:read","search:message","space:document:delete","space:document:move","space:document:retrieve","task:comment:read","task:comment:write","task:task:read","task:task:write","task:task:writeonly","task:tasklist:read","task:tasklist:write","wiki:node:copy","wiki:node:create","wiki:node:move","wiki:node:read","wiki:node:retrieve","wiki:space:read","wiki:space:retrieve","wiki:space:write_only"]}}';

  document.getElementById("s-ch-feishu-copy-perms").addEventListener("click", function() {
    navigator.clipboard.writeText(FEISHU_PERMISSIONS_JSON).then(function() {
      showSettingsToast(tt("settings_ch_feishu_perms_copied"));
    });
  });

  document.getElementById("s-ch-feishu-setup-btn").addEventListener("click", function() {
    document.getElementById("s-ch-feishu-appid").value = "";
    document.getElementById("s-ch-feishu-secret").value = "";
    showFeishuState("form", null);
  });

  document.getElementById("s-ch-feishu-cancel-btn").addEventListener("click", function() {
    loadSettingsChannels();
  });

  document.getElementById("s-ch-feishu-connect-btn").addEventListener("click", function() {
    var appId = document.getElementById("s-ch-feishu-appid").value.trim();
    var secret = document.getElementById("s-ch-feishu-secret").value.trim();
    if (!appId || !secret) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = tt("settings_ch_connecting");
    adminApi("channels/feishu", "POST", { app_id: appId, app_secret: secret })
      .then(function(d) {
        if (d && d.ok) {
          showSettingsToast(tt("settings_ch_connect_ok"));
          showFeishuState("connected", d);
        } else {
          showSettingsToast(d && d.error ? d.error : tt("settings_ch_connect_fail"));
          showFeishuState("form", null);
        }
      })
      .catch(function() { showSettingsToast(tt("settings_ch_connect_fail")); })
      .finally(function() { btn.disabled = false; btn.textContent = tt("settings_ch_connect"); });
  });

  document.getElementById("s-ch-feishu-disconnect-btn").addEventListener("click", function() {
    if (!confirm(tt("settings_confirm_delete"))) return;
    adminApi("channels/feishu", "DELETE")
      .then(function() {
        showSettingsToast(tt("settings_ch_disconnected"));
        showFeishuState("setup", null);
      })
      .catch(function() { showSettingsToast(tt("settings_failed")); });
  });

`;
}
