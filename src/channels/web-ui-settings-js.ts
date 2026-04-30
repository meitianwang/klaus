/** Chat UI settings panel JavaScript (tabs, MCP, Cron, Channels). */

export function getSettingsJs(): string {
  return `
  // --- Settings tab switching ---
  var sNavItems = document.querySelectorAll(".settings-nav-item[data-stab]");
  var sTabPanels = document.querySelectorAll(".settings-tab-panel");
  function switchSettingsTab(id) {
    sNavItems.forEach(function(n) { n.classList.toggle("active", n.getAttribute("data-stab") === id); });
    sTabPanels.forEach(function(p) { p.classList.toggle("active", p.id === "stab-" + id); });
    if (id === "skills") loadAllSkillData();
    if (id === "mcp" && isAdmin) loadMcpServers();
    if (id === "cron") loadCronTasks();
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
    // Show/hide admin-only tabs (MCP is admin-only; cron is available to all users)
    var mcpNav = document.querySelector("[data-stab='mcp']");
    if (isAdmin) {
      if (mcpNav) mcpNav.style.display = "";
    } else {
      if (mcpNav) mcpNav.style.display = "none";
    }
  }
  function hideSettings() {
    settingsView.style.display = "none";
    chatElements.forEach(function(el) { if (el) el.style.display = ""; });
    closeChModal();
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

  // Permission Mode
  var permOptionsEl = document.getElementById("settings-permission-options");
  function loadUserPermissionMode() {
    fetch("/api/user/settings", { credentials: "same-origin" })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var mode = d.permission_mode || "default";
        permOptionsEl.querySelectorAll(".perm-row").forEach(function(c) {
          c.classList.toggle("active", c.getAttribute("data-perm") === mode);
        });
      }).catch(function() {});
  }
  loadUserPermissionMode();
  permOptionsEl.addEventListener("click", function(e) {
    var card = e.target.closest(".perm-row");
    if (!card) return;
    var mode = card.getAttribute("data-perm");
    permOptionsEl.querySelectorAll(".perm-row").forEach(function(c) {
      c.classList.toggle("active", c.getAttribute("data-perm") === mode);
    });
    fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ permission_mode: mode }),
    }).then(function(r) {
      if (!r.ok) throw new Error();
      var status = document.getElementById("settings-save-status");
      status.textContent = tt("settings_saved") || "Saved";
      setTimeout(function() { status.textContent = ""; }, 2000);
    }).catch(function() {});
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
  function escS(s) { if (s == null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

  function mcpApi(_, method, params) {
    var qs = "";
    var opts = { method: method || "GET", credentials: "same-origin" };
    if (method === "POST" || method === "PATCH") {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(params || {});
    } else if (params) {
      var pairs = [];
      Object.keys(params).forEach(function(k) { if (params[k] != null) pairs.push(k + "=" + encodeURIComponent(params[k])); });
      qs = pairs.join("&");
    }
    var url = "/api/mcp" + (qs ? "?" + qs : "");
    return fetch(url, opts).then(function(r) { if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.json(); });
  }

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

  function userApi(path, method, params) {
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
    var url = "/api/" + path + (qs ? "?" + qs : "");
    return fetch(url, opts).then(function(r) { if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.json(); });
  }

  // =====================================================
  // MCP SERVERS (in settings)
  // =====================================================
  var sMcpWrap = document.getElementById("s-mcp-wrap");
  var sMcpEmpty = document.getElementById("s-mcp-empty");
  var sMcpAddBtn = document.getElementById("s-mcp-add-btn");
  var sMcpAddMenu = document.getElementById("s-mcp-add-menu");
  var sMcpManualForm = document.getElementById("s-mcp-manual-form");
  var sMcpJsonForm = document.getElementById("s-mcp-json-form");
  var sMcpfType = document.getElementById("s-mcpf-type");
  var sMcpfName = document.getElementById("s-mcpf-name");
  var sMcpfCommand = document.getElementById("s-mcpf-command");
  var sMcpfUrl = document.getElementById("s-mcpf-url");
  var sMcpfCommandWrap = document.getElementById("s-mcpf-command-wrap");
  var sMcpfUrlWrap = document.getElementById("s-mcpf-url-wrap");
  var sMcpfEnvRows = document.getElementById("s-mcpf-env-rows");
  var sMcpfTimeout = document.getElementById("s-mcpf-timeout");

  // Toggle add dropdown menu
  sMcpAddBtn.onclick = function(e) {
    e.stopPropagation();
    sMcpAddMenu.style.display = sMcpAddMenu.style.display === "none" ? "block" : "none";
  };
  document.addEventListener("click", function(e) {
    if (!sMcpAddMenu.contains(e.target) && e.target !== sMcpAddBtn) sMcpAddMenu.style.display = "none";
  });

  // Menu item hover
  document.querySelectorAll(".s-mcp-menu-item").forEach(function(item) {
    item.addEventListener("mouseenter", function() { item.style.background = "var(--s-bg-hover,#f1f5f9)"; });
    item.addEventListener("mouseleave", function() { item.style.background = "none"; });
  });

  // Open manual form
  document.getElementById("s-mcp-menu-manual").onclick = function() {
    sMcpAddMenu.style.display = "none";
    sMcpJsonForm.style.display = "none";
    resetManualMcpForm();
    sMcpManualForm.style.display = "block";
    sMcpWrap.style.display = "none";
    sMcpfName.focus();
  };
  // Open JSON form
  document.getElementById("s-mcp-menu-json").onclick = function() {
    sMcpAddMenu.style.display = "none";
    sMcpManualForm.style.display = "none";
    sMcpJsonForm.style.display = "block";
    sMcpWrap.style.display = "none";
    document.getElementById("s-mcpf-json").focus();
  };
  // Close forms
  document.getElementById("s-mcp-manual-close").onclick = function() {
    sMcpManualForm.style.display = "none"; sMcpWrap.style.display = "";
  };
  document.getElementById("s-mcp-json-close").onclick = function() {
    sMcpJsonForm.style.display = "none"; sMcpWrap.style.display = "";
  };

  // Server type toggle (stdio vs url-based)
  sMcpfType.addEventListener("change", function() {
    var isStdio = sMcpfType.value === "stdio";
    sMcpfCommandWrap.style.display = isStdio ? "" : "none";
    sMcpfUrlWrap.style.display = isStdio ? "none" : "";
  });

  // Env var row management
  function addMcpEnvRow(key, val) {
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-bottom:4px;align-items:center";
    row.innerHTML = "<input class='s-form-input' placeholder='API_KEY' value='" + escS(key || "") + "' style='flex:1' data-envkey>"
      + "<input class='s-form-input' placeholder='your-api-key' value='" + escS(val || "") + "' style='flex:1' data-envval>"
      + "<button class='s-btn s-btn-ghost' style='padding:4px 8px;font-size:16px;opacity:0.5' data-envdel>&times;</button>";
    row.querySelector("[data-envdel]").onclick = function() { row.remove(); };
    sMcpfEnvRows.appendChild(row);
  }
  document.getElementById("s-mcpf-add-env").onclick = function() { addMcpEnvRow("", ""); };

  // Paste env vars (KEY=VALUE per line)
  document.getElementById("s-mcpf-paste-env").onclick = function() {
    navigator.clipboard.readText().then(function(text) {
      var lines = text.trim().split("\\n");
      lines.forEach(function(line) {
        var eq = line.indexOf("=");
        if (eq > 0) addMcpEnvRow(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
      });
    }).catch(function() {});
  };

  function getMcpEnvVars() {
    var env = {};
    sMcpfEnvRows.querySelectorAll("[data-envkey]").forEach(function(el) {
      var key = el.value.trim();
      var val = el.parentElement.querySelector("[data-envval]").value;
      if (key) env[key] = val;
    });
    return Object.keys(env).length ? env : undefined;
  }

  function resetManualMcpForm() {
    sMcpfType.value = "stdio"; sMcpfName.value = ""; sMcpfCommand.value = ""; sMcpfUrl.value = "";
    sMcpfTimeout.value = ""; sMcpfEnvRows.innerHTML = "";
    sMcpfCommandWrap.style.display = ""; sMcpfUrlWrap.style.display = "none";
  }

  // Save manual config
  document.getElementById("s-mcpf-save").onclick = function() {
    var name = sMcpfName.value.trim();
    if (!name) { showSettingsToast(tt("settings_mcp_name_required")); return; }
    var type = sMcpfType.value;
    var payload = { name: name };
    if (type === "stdio") {
      var cmdStr = sMcpfCommand.value.trim();
      if (!cmdStr) return;
      var parts = cmdStr.match(/(?:[^\\s"]+|"[^"]*")+/g) || [cmdStr];
      parts = parts.map(function(p) { return p.replace(/^"|"$/g, ""); });
      payload.command = parts[0];
      if (parts.length > 1) payload.args = parts.slice(1);
    } else {
      var url = sMcpfUrl.value.trim();
      if (!url) return;
      payload.type = type;
      payload.url = url;
    }
    var env = getMcpEnvVars();
    if (env) payload.env = env;
    var timeout = parseInt(sMcpfTimeout.value);
    if (timeout > 0) payload.timeout = timeout;

    var btn = document.getElementById("s-mcpf-save");
    btn.disabled = true;
    mcpApi("", "POST", payload)
      .then(function() { sMcpManualForm.style.display = "none"; sMcpWrap.style.display = ""; resetManualMcpForm(); showSettingsToast(tt("settings_saved")); loadMcpServers(); })
      .catch(function() { showSettingsToast(tt("settings_failed")); })
      .finally(function() { btn.disabled = false; });
  };

  // JSON import
  document.getElementById("s-mcpf-json-import").onclick = function() {
    var raw = document.getElementById("s-mcpf-json").value.trim();
    if (!raw) return;
    // Strip // comments
    var cleaned = raw.replace(/\\/\\/[^\\n]*/g, "").trim();
    var parsed;
    try { parsed = JSON.parse(cleaned); } catch(e) { showSettingsToast(tt("settings_mcp_import_failed") + ": Invalid JSON"); return; }

    var servers = parsed.mcpServers || parsed;
    if (typeof servers !== "object" || Array.isArray(servers)) { showSettingsToast(tt("settings_mcp_import_failed") + ": Expected mcpServers object"); return; }

    var names = Object.keys(servers);
    if (!names.length) { showSettingsToast(tt("settings_mcp_import_failed") + ": No servers found"); return; }

    var btn = document.getElementById("s-mcpf-json-import");
    btn.disabled = true;
    var pending = names.length;
    var errors = [];
    names.forEach(function(sname) {
      var config = Object.assign({}, servers[sname], { name: sname });
      mcpApi("", "POST", config)
        .catch(function(e) { errors.push(sname + ": " + (e.message || e)); })
        .finally(function() {
          pending--;
          if (pending === 0) {
            btn.disabled = false;
            if (errors.length) { showSettingsToast(tt("settings_mcp_import_failed") + ": " + errors.join(", ")); }
            else { sMcpJsonForm.style.display = "none"; sMcpWrap.style.display = ""; document.getElementById("s-mcpf-json").value = ""; showSettingsToast(tt("settings_mcp_imported")); }
            loadMcpServers();
          }
        });
    });
  };

  function loadMcpServers() {
    mcpApi("", "GET").then(function(d) {
      var servers = d.servers || [];
      if (!servers.length) { sMcpWrap.innerHTML = ""; sMcpEmpty.style.display = "block"; return; }
      sMcpEmpty.style.display = "none";
      sMcpWrap.innerHTML = '<div class="sk-grid">' + servers.map(function(s) {
        var cfg = s.config || {};
        var type = cfg.type || "stdio";
        var detail = "";
        if (type === "stdio") {
          detail = escS(cfg.command || "");
          if (cfg.args && cfg.args.length) detail += " " + cfg.args.map(function(a) { return escS(a); }).join(" ");
        } else {
          detail = escS(cfg.url || "");
        }
        var enabled = s.enabled !== false;
        var toggle = '<label class="sk-toggle"><input type="checkbox" class="mcp-toggle-input" data-mcp="' + escS(s.name) + '"' + (enabled ? ' checked' : '') + '><span class="sk-slider"></span></label>';
        var typeBadge = '<span class="s-badge s-badge-gray">' + escS(type.toUpperCase()) + '</span>';
        var uninstallBtn = '<button class="sk-uninstall-btn" data-delmcp="' + escS(s.name) + '">' + tt("settings_mcp_uninstall") + '</button>';
        return '<div class="sk-card">' +
          '<div class="sk-card-head">' +
            '<div class="sk-card-info"><div class="sk-card-emoji">\u{1F50C}</div><div class="sk-card-name">' + escS(s.name) + '</div></div>' +
            toggle +
          '</div>' +
          '<div class="sk-card-desc">' + detail + '</div>' +
          '<div class="sk-card-actions">' + uninstallBtn + '</div>' +
          '<div class="sk-card-badges">' + typeBadge + '</div>' +
        '</div>';
      }).join("") + '</div>';

      // Bind toggles
      sMcpWrap.querySelectorAll(".mcp-toggle-input").forEach(function(el) {
        el.addEventListener("change", function() {
          var name = el.getAttribute("data-mcp");
          mcpApi("", "PATCH", { name: name, enabled: el.checked })
            .then(function() { loadMcpServers(); })
            .catch(function() { loadMcpServers(); });
        });
      });
      // Bind uninstall buttons
      sMcpWrap.querySelectorAll(".sk-uninstall-btn[data-delmcp]").forEach(function(el) {
        el.addEventListener("click", async function() {
          var name = el.getAttribute("data-delmcp");
          if (!(await window.klausDialog.confirm({ message: tt("settings_mcp_delete_confirm"), danger: true }))) return;
          mcpApi("", "DELETE", { name: name })
            .then(function() { loadMcpServers(); showSettingsToast(tt("settings_deleted")); });
        });
      });
    });
  }

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
  var sCfFreq = document.getElementById("s-cf-freq");
  var sCfTime = document.getElementById("s-cf-time");
  var sCfCustomWrap = document.getElementById("s-cf-custom-wrap");
  var sCfSchedule = document.getElementById("s-cf-schedule");
  var sCfPrompt = document.getElementById("s-cf-prompt");
  var sCfSave = document.getElementById("s-cf-save");
  var sCfCancel = document.getElementById("s-cf-cancel");

  // Build a cron expression from dropdown + time picker. Returns null for 'custom'.
  function sCronCompile(freq, time) {
    if (freq === "custom") return null;
    var parts = (time || "09:00").split(":");
    var hh = parseInt(parts[0], 10) || 0;
    var mm = parseInt(parts[1], 10) || 0;
    var head = mm + " " + hh + " * * ";
    if (freq === "daily") return head + "*";
    if (freq === "weekdays") return head + "1-5";
    if (freq === "weekends") return head + "0,6";
    return head + freq;
  }
  function sCronSetCustomMode(on) {
    sCfCustomWrap.style.display = on ? "block" : "none";
    sCfTime.style.display = on ? "none" : "";
  }

  function loadCronTasks() {
    userApi("cron/tasks", "GET").then(function(d) {
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
      var h = "<table class='s-table'><thead><tr><th>ID</th><th>" + tt("settings_cron_task_name") + "</th><th>" + tt("settings_cron_type") + "</th><th>" + tt("settings_cron_schedule") + "</th><th>Status</th><th>" + tt("settings_cron_next") + "</th><th></th></tr></thead><tbody>";
      tasks.forEach(function(t) {
        var isOneShot = t.deleteAfterRun;
        var typeBadge = isOneShot
          ? "<span class='s-badge s-badge-blue'>" + tt("settings_cron_oneshot") + "</span>"
          : "<span class='s-badge s-badge-purple'>" + tt("settings_cron_recurring") + "</span>";
        var badge;
        if (t.lastRun && t.lastRun.error) {
          badge = "<span class='s-badge s-badge-red'>Error</span>";
        } else if (isOneShot && !t.nextRun && t.lastRun) {
          badge = "<span class='s-badge s-badge-gray'>" + tt("settings_cron_fired") + "</span>";
        } else if (t.enabled) {
          badge = "<span class='s-badge s-badge-green'>" + tt("settings_on") + "</span>";
        } else {
          badge = "<span class='s-badge s-badge-gray'>" + tt("settings_off") + "</span>";
        }
        h += "<tr>"
          + "<td><span class='s-code'>" + escS(t.id) + "</span></td>"
          + "<td>" + escS(t.name || "-") + "</td>"
          + "<td>" + typeBadge + "</td>"
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
    sCfId.value = ""; sCfName.value = ""; sCfPrompt.value = "";
    sCfFreq.value = "daily";
    sCfTime.value = "09:00";
    sCfSchedule.value = "";
    sCronSetCustomMode(false);
    sCfId.disabled = false;
    sCronForm.style.display = "block";
    sCfId.focus();
  };
  sCfCancel.onclick = function() { sCronForm.style.display = "none"; };
  sCfFreq.onchange = function() { sCronSetCustomMode(sCfFreq.value === "custom"); };

  sCfSave.onclick = function() {
    var id = sCfId.value.trim();
    var prompt = sCfPrompt.value.trim();
    var isCustom = sCfFreq.value === "custom";
    var schedule = isCustom ? sCfSchedule.value.trim() : sCronCompile(sCfFreq.value, sCfTime.value);
    if (!id || !schedule || !prompt) return;
    if (isCustom && schedule.split(/\s+/).length !== 5) {
      showSettingsToast(tt("cron_form_schedule_invalid"));
      return;
    }
    sCfSave.disabled = true;
    var payload = { id: id, schedule: schedule, prompt: prompt, name: sCfName.value.trim() || undefined, enabled: true };
    userApi("cron/tasks", "POST", payload)
      .then(function() { sCronForm.style.display = "none"; showSettingsToast(tt("settings_saved")); loadCronTasks(); })
      .catch(function() { showSettingsToast(tt("settings_failed")); })
      .finally(function() { sCfSave.disabled = false; });
  };

  sCronWrap.addEventListener("click", async function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.togglecron) {
      var enabled = btn.dataset.enabled === "1";
      userApi("cron/tasks?id=" + encodeURIComponent(btn.dataset.togglecron), "PATCH", { enabled: !enabled })
        .then(function() { loadCronTasks(); });
    } else if (btn.dataset.delcron) {
      if (!(await window.klausDialog.confirm({ message: tt("settings_cron_delete_confirm"), danger: true }))) return;
      userApi("cron/tasks?id=" + encodeURIComponent(btn.dataset.delcron), "DELETE")
        .then(function() { loadCronTasks(); showSettingsToast(tt("settings_deleted")); });
    }
  });

  // --- Settings: Channels tab ---
  // =====================================================
  // CHANNEL MODAL
  // =====================================================
  var chModalOverlay = document.getElementById("ch-modal-overlay");
  var chModalIcon = document.getElementById("ch-modal-icon");
  var chModalTitle = document.getElementById("ch-modal-title");
  var chModalDesc = document.getElementById("ch-modal-desc");
  var chModalContents = document.querySelectorAll("[id$='-modal-content']");
  function openChModal(channelId, icon, title, desc) {
    chModalIcon.src = icon;
    chModalTitle.textContent = title;
    chModalDesc.textContent = desc;
    chModalContents.forEach(function(el) { el.style.display = "none"; });
    var content = document.getElementById("s-ch-" + channelId + "-modal-content");
    if (content) content.style.display = "block";
    chModalOverlay.classList.add("show");
  }

  function closeChModal() {
    chModalOverlay.classList.remove("show");
    if (wxPollTimer) { clearInterval(wxPollTimer); wxPollTimer = null; }
    if (typeof waPollTimer !== "undefined" && waPollTimer) { clearInterval(waPollTimer); waPollTimer = null; }
  }

  document.getElementById("ch-modal-close").addEventListener("click", closeChModal);
  chModalOverlay.addEventListener("click", function(e) { if (e.target === chModalOverlay) closeChModal(); });
  document.addEventListener("keydown", function(e) { if (e.key === "Escape" && chModalOverlay.classList.contains("show")) closeChModal(); });

  // Channel card button state
  function updateCardBtn(channelId, connected) {
    var btn = document.getElementById("s-ch-" + channelId + "-cfg-btn");
    if (!btn) return;
    if (connected) {
      btn.textContent = tt("settings_ch_configured");
      btn.className = "ch-card-btn connected";
    } else {
      btn.textContent = tt("settings_ch_setup");
      btn.className = "ch-card-btn";
    }
  }

  // --- Channel config (data-driven) ---
  var chConfigs = [
    { id: "feishu", icon: "/feishu.png", displays: [["appid-display","app_id"],["bot-display","bot_name"]], inputs: [["appid","app_id"],["secret","app_secret"]] },
    { id: "dingtalk", icon: "/dingtalk.png", displays: [["clientid-display","client_id"]], inputs: [["clientid","client_id"],["secret","client_secret"]] },
    { id: "wecom", icon: "/wecom-icon.png", displays: [["botid-display","bot_id"]], inputs: [["botid","bot_id"],["secret","secret"]] },
    { id: "qq", icon: "/qq-icon.png", displays: [["appid-display","app_id"]], inputs: [["appid","app_id"],["secret","client_secret"]] },
    { id: "telegram", icon: "/telegram-icon.png", displays: [["bot-display","bot_username"]], inputs: [["token","bot_token"]] },
    { id: "whatsapp", icon: "/whatsapp-icon.png", displays: [], inputs: [] }
  ];

  // Generic state toggle for standard 2-state channels (connected/form)
  function showChannelState(id, state, data) {
    var el = function(suffix) { return document.getElementById("s-ch-" + id + "-" + suffix); };
    el("connected").style.display = state === "connected" ? "block" : "none";
    el("form").style.display = state === "connected" ? "none" : "block";
    updateCardBtn(id, state === "connected");
    if (state === "connected") {
      var cfg = chConfigs.filter(function(c) { return c.id === id; })[0];
      if (cfg) cfg.displays.forEach(function(d) {
        var target = el(d[0]);
        if (target) target.textContent = data && data[d[1]] || (d[0].indexOf("bot") >= 0 ? "-" : "");
      });
    }
  }

  // WeChat is special: 3 states (connected/qr/setup)
  function showWechatState(state, data) {
    document.getElementById("s-ch-wechat-connected").style.display = state === "connected" ? "block" : "none";
    document.getElementById("s-ch-wechat-qr").style.display = state === "qr" ? "block" : "none";
    document.getElementById("s-ch-wechat-setup").style.display = state !== "connected" && state !== "qr" ? "block" : "none";
    updateCardBtn("wechat", state === "connected");
    if (state === "connected") {
      document.getElementById("s-ch-wechat-account-display").textContent = data && data.account_id || "";
    }
  }

  function loadSettingsChannels() {
    adminApi("channels", "GET").then(function(d) {
      chConfigs.forEach(function(cfg) {
        if (cfg.id === "whatsapp") return; // WhatsApp has custom state management
        var ch = d && d[cfg.id];
        showChannelState(cfg.id, ch && ch.enabled ? "connected" : "setup", ch);
      });
      var wx = d && d.wechat;
      showWechatState(wx && wx.enabled ? "connected" : "setup", wx);
      var wa = d && d.whatsapp;
      showWhatsAppState(wa && wa.enabled ? "connected" : "setup", wa);
    }).catch(function() {
      chConfigs.forEach(function(cfg) { showChannelState(cfg.id, "setup", null); });
      showWechatState("setup", null);
      showWhatsAppState("setup", null);
    });
  }

  // Card click -> open modal
  [{ id: "wechat", icon: "/wechat-icon.png" }].concat(chConfigs).forEach(function(cfg) {
    document.getElementById("s-ch-" + cfg.id + "-cfg-btn").addEventListener("click", function() {
      var card = document.getElementById("s-ch-" + cfg.id + "-card");
      var nameEl = card.querySelector("[data-i18n]");
      var descEl = card.querySelector(".ch-card-desc");
      openChModal(cfg.id, cfg.icon, nameEl ? nameEl.textContent : cfg.id, descEl ? descEl.textContent : "");
      // WeChat: auto-trigger QR scan when modal opens and not connected
      if (cfg.id === "wechat") {
        var connected = document.getElementById("s-ch-wechat-connected");
        if (connected && connected.style.display === "none") {
          document.getElementById("s-ch-wechat-login-btn").click();
        }
      }
      // WhatsApp: auto-trigger QR flow when modal opens and not connected
      if (cfg.id === "whatsapp") {
        var waConn = document.getElementById("s-ch-whatsapp-connected");
        if (waConn && waConn.style.display === "none") {
          startWhatsAppQr();
        }
      }
    });
  });

  // Generic connect handler for standard channels
  function connectChannel(cfg) {
    var btn = document.getElementById("s-ch-" + cfg.id + "-connect-btn");
    btn.addEventListener("click", function() {
      var payload = {};
      var valid = true;
      cfg.inputs.forEach(function(inp) {
        var val = document.getElementById("s-ch-" + cfg.id + "-" + inp[0]).value.trim();
        if (!val) valid = false;
        payload[inp[1]] = val;
      });
      if (!valid) return;
      btn.disabled = true;
      btn.textContent = tt("settings_ch_connecting");
      adminApi("channels/" + cfg.id, "POST", payload)
        .then(function(d) {
          if (d && d.ok) {
            showSettingsToast(tt("settings_ch_connect_ok"));
            showChannelState(cfg.id, "connected", d);
          } else {
            showSettingsToast(d && d.error ? d.error : tt("settings_ch_connect_fail"));
          }
        })
        .catch(function() { showSettingsToast(tt("settings_ch_connect_fail")); })
        .finally(function() { btn.disabled = false; btn.textContent = tt("settings_ch_connect"); });
    });
  }

  // Generic disconnect handler
  function disconnectChannel(id, showFn) {
    document.getElementById("s-ch-" + id + "-disconnect-btn").addEventListener("click", async function() {
      if (!(await window.klausDialog.confirm({ message: tt("settings_confirm_delete"), danger: true }))) return;
      adminApi("channels/" + id, "DELETE")
        .then(function() {
          showSettingsToast(tt("settings_ch_disconnected"));
          showFn("setup", null);
        })
        .catch(function() { showSettingsToast(tt("settings_failed")); });
    });
  }

  // Wire up standard channels
  chConfigs.forEach(function(cfg) {
    connectChannel(cfg);
    disconnectChannel(cfg.id, function(s, d) { showChannelState(cfg.id, s, d); });
  });

  // --- Feishu: extra permissions copy button ---
  var FEISHU_PERMISSIONS_JSON = '{"scopes":{"tenant":["contact:contact.base:readonly","docx:document:readonly","im:chat:read","im:chat:update","im:message.group_at_msg:readonly","im:message.p2p_msg:readonly","im:message.pins:read","im:message.pins:write_only","im:message.reactions:read","im:message.reactions:write_only","im:message:readonly","im:message:recall","im:message:send_as_bot","im:message:send_multi_users","im:message:send_sys_msg","im:message:update","im:resource","application:application:self_manage","cardkit:card:write","cardkit:card:read"],"user":["contact:user.employee_id:readonly","offline_access","base:app:copy","base:field:create","base:field:delete","base:field:read","base:field:update","base:record:create","base:record:delete","base:record:retrieve","base:record:update","base:table:create","base:table:delete","base:table:read","base:table:update","base:view:read","base:view:write_only","base:app:create","base:app:update","base:app:read","board:whiteboard:node:create","board:whiteboard:node:read","calendar:calendar:read","calendar:calendar.event:create","calendar:calendar.event:delete","calendar:calendar.event:read","calendar:calendar.event:reply","calendar:calendar.event:update","calendar:calendar.free_busy:read","contact:contact.base:readonly","contact:user.base:readonly","contact:user:search","docs:document.comment:create","docs:document.comment:read","docs:document.comment:update","docs:document.media:download","docs:document:copy","docx:document:create","docx:document:readonly","docx:document:write_only","drive:drive.metadata:readonly","drive:file:download","drive:file:upload","im:chat.members:read","im:chat:read","im:message","im:message.group_msg:get_as_user","im:message.p2p_msg:get_as_user","im:message:readonly","search:docs:read","search:message","space:document:delete","space:document:move","space:document:retrieve","task:comment:read","task:comment:write","task:task:read","task:task:write","task:task:writeonly","task:tasklist:read","task:tasklist:write","wiki:node:copy","wiki:node:create","wiki:node:move","wiki:node:read","wiki:node:retrieve","wiki:space:read","wiki:space:retrieve","wiki:space:write_only"]}}';

  document.getElementById("s-ch-feishu-copy-perms").addEventListener("click", function() {
    navigator.clipboard.writeText(FEISHU_PERMISSIONS_JSON).then(function() {
      showSettingsToast(tt("settings_ch_feishu_perms_copied"));
    });
  });

  // --- WeChat: QR code flow ---
  var wxPollTimer = null;
  function startWxQrPoll() {
    if (wxPollTimer) clearInterval(wxPollTimer);
    wxPollTimer = setInterval(function() {
      adminApi("channels/wechat/qr-poll", "GET").then(function(d) {
        var statusEl = document.getElementById("s-ch-wechat-qr-status");
        if (d.status === "scaned") {
          statusEl.textContent = tt("settings_ch_wechat_scanned");
        } else if (d.status === "confirmed" && d.ok) {
          clearInterval(wxPollTimer);
          wxPollTimer = null;
          showSettingsToast(tt("settings_ch_connect_ok"));
          showWechatState("connected", d);
        } else if (d.status === "expired") {
          statusEl.textContent = tt("settings_ch_wechat_expired");
          clearInterval(wxPollTimer);
          wxPollTimer = null;
        }
      }).catch(function() {});
    }, 3000);
  }

  document.getElementById("s-ch-wechat-login-btn").addEventListener("click", function() {
    var btn = this;
    btn.disabled = true;
    adminApi("channels/wechat/qr-start", "POST").then(function(d) {
      if (d.qrcodeDataUrl) {
        document.getElementById("s-ch-wechat-qr-img").src = d.qrcodeDataUrl;
        showWechatState("qr", null);
        startWxQrPoll();
      } else {
        showSettingsToast(d.message || tt("settings_ch_connect_fail"));
      }
    }).catch(function() {
      showSettingsToast(tt("settings_ch_connect_fail"));
    }).finally(function() { btn.disabled = false; });
  });

  disconnectChannel("wechat", showWechatState);

  // --- WhatsApp QR flow (similar to WeChat) ---
  var waPollTimer = null;

  function showWhatsAppState(state, data) {
    document.getElementById("s-ch-whatsapp-connected").style.display = state === "connected" ? "block" : "none";
    document.getElementById("s-ch-whatsapp-qr").style.display = state === "qr" ? "block" : "none";
    document.getElementById("s-ch-whatsapp-setup").style.display = state === "setup" || state === "waiting" ? "block" : "none";
    updateCardBtn("whatsapp", state === "connected");
  }

  function startWhatsAppQr() {
    showWhatsAppState("waiting", null);
    adminApi("channels/whatsapp", "POST").then(function(d) {
      if (d.status === "connected") {
        showWhatsAppState("connected", null);
        showSettingsToast(tt("settings_ch_connect_ok"));
      } else if (d.status === "qr" && d.qrcodeDataUrl) {
        document.getElementById("s-ch-whatsapp-qr-img").src = d.qrcodeDataUrl;
        showWhatsAppState("qr", null);
        startWaPoll();
      } else {
        // Still starting, poll
        startWaPoll();
      }
    }).catch(function() {
      showSettingsToast(tt("settings_ch_connect_fail"));
      showWhatsAppState("setup", null);
    });
  }

  function startWaPoll() {
    if (waPollTimer) clearInterval(waPollTimer);
    waPollTimer = setInterval(function() {
      adminApi("channels/whatsapp/qr-poll", "GET").then(function(d) {
        if (d.status === "connected") {
          showWhatsAppState("connected", null);
          showSettingsToast(tt("settings_ch_connect_ok"));
          clearInterval(waPollTimer);
          waPollTimer = null;
        } else if (d.status === "qr" && d.qrcodeDataUrl) {
          document.getElementById("s-ch-whatsapp-qr-img").src = d.qrcodeDataUrl;
          showWhatsAppState("qr", null);
        }
      }).catch(function() {});
    }, 3000);
  }

  // Override WhatsApp disconnect to clean up poll timer
  document.getElementById("s-ch-whatsapp-disconnect-btn").addEventListener("click", async function() {
    if (!(await window.klausDialog.confirm({ message: tt("settings_confirm_delete"), danger: true }))) return;
    if (waPollTimer) { clearInterval(waPollTimer); waPollTimer = null; }
    adminApi("channels/whatsapp", "DELETE").then(function() {
      showWhatsAppState("setup", null);
      showSettingsToast(tt("settings_ch_disconnected"));
    });
  });

  // --- Skills tab ---
  var skGrid = document.getElementById("sk-grid");
  var skEmpty = document.getElementById("sk-empty");
  var skSearch = document.getElementById("sk-search");
  var skInstalledData = [];
  var skMarketData = [];
  var skBuiltinData = [];
  var skFilter = "market";

  function esc(s) { if (s == null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function renderSkillCards() {
    var items;
    if (skFilter === "market") {
      items = skMarketData;
    } else if (skFilter === "builtin") {
      items = skBuiltinData;
    } else if (skFilter === "installed") {
      items = skInstalledData;
    } else if (skFilter === "enabled") {
      items = skInstalledData.filter(function(s) { return s.userEnabled; });
    } else {
      items = skInstalledData.filter(function(s) { return !s.userEnabled; });
    }
    var query = (skSearch.value || "").toLowerCase().trim();
    if (query) {
      items = items.filter(function(s) {
        return s.name.toLowerCase().indexOf(query) >= 0 || (s.description || "").toLowerCase().indexOf(query) >= 0;
      });
    }
    if (items.length === 0) {
      skGrid.innerHTML = "";
      skEmpty.style.display = "";
      return;
    }
    skEmpty.style.display = "none";
    if (skFilter === "builtin") {
      // Built-in cards: read-only display, no toggle/uninstall
      skGrid.innerHTML = items.map(function(s) {
        return '<div class="sk-card">' +
          '<div class="sk-card-head">' +
            '<div class="sk-card-info"><div class="sk-card-emoji">\u{1F9E9}</div><div class="sk-card-name">/' + esc(s.name) + '</div></div>' +
          '</div>' +
          '<div class="sk-card-desc">' + esc(s.description || '') + '</div>' +
          '<div class="sk-card-badges"><span class="s-badge s-badge-gray">' + esc(s.source) + '</span></div>' +
        '</div>';
      }).join("");
    } else if (skFilter === "market") {
      // Market cards: name, description, install button
      skGrid.innerHTML = items.map(function(s) {
        var btnClass = s.installed ? "sk-install-market-btn installed" : "sk-install-market-btn";
        var btnText = s.installed ? tt("settings_skills_installed_badge") : tt("settings_skills_install");
        return '<div class="sk-card">' +
          '<div class="sk-card-head">' +
            '<div class="sk-card-info"><div class="sk-card-emoji">\u{1F9E9}</div><div class="sk-card-name">' + esc(s.name) + '</div></div>' +
          '</div>' +
          '<div class="sk-card-desc">' + esc(s.description || '') + '</div>' +
          '<div class="sk-card-actions">' +
            '<button class="' + btnClass + '" data-skill="' + esc(s.dirName || s.name) + '"' + (s.installed ? ' disabled' : '') + '>' + btnText + '</button>' +
          '</div>' +
        '</div>';
      }).join("");
      // Bind install buttons
      skGrid.querySelectorAll(".sk-install-market-btn:not(.installed)").forEach(function(el) {
        el.addEventListener("click", function() {
          var name = el.getAttribute("data-skill");
          el.disabled = true;
          el.textContent = tt("settings_skills_uploading");
          fetch("/api/skills/install", { method: "POST", credentials: "same-origin", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: name }) }).then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function() {
            showSettingsToast(tt("settings_skills_installed_toast"));
            loadAllSkillData();
          }).catch(function(e) {
            showSettingsToast("Error: " + (e.message || e));
            loadAllSkillData();
          });
        });
      });
    } else {
      // Installed/enabled/disabled cards: toggle + uninstall
      skGrid.innerHTML = items.map(function(s) {
        var srcBadge = '<span class="s-badge s-badge-gray">' + esc(s.source) + '</span>';
        var toggle = '<label class="sk-toggle"><input type="checkbox" class="sk-toggle-input" data-skill="' + esc(s.name) + '"' + (s.userEnabled ? ' checked' : '') + '><span class="sk-slider"></span></label>';
        var uninstallBtn = s.installed ? '<button class="sk-uninstall-btn" data-skill="' + esc(s.name) + '">' + tt("settings_skills_uninstall") + '</button>' : '';
        return '<div class="sk-card">' +
          '<div class="sk-card-head">' +
            '<div class="sk-card-info"><div class="sk-card-emoji">\u{1F9E9}</div><div class="sk-card-name">' + esc(s.name) + '</div></div>' +
            toggle +
          '</div>' +
          '<div class="sk-card-desc">' + esc(s.description || '') + '</div>' +
          '<div class="sk-card-actions">' + uninstallBtn + '</div>' +
          '<div class="sk-card-badges">' + srcBadge + '</div>' +
        '</div>';
      }).join("");
      // Bind toggles
      skGrid.querySelectorAll(".sk-toggle-input").forEach(function(el) {
        el.addEventListener("change", function() {
          var name = el.getAttribute("data-skill");
          fetch("/api/skills", { method: "PATCH", credentials: "same-origin", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: name, enabled: el.checked }) }).then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function() {
            showSettingsToast(tt(el.checked ? "settings_skills_on" : "settings_skills_off"));
            loadInstalledSkills();
          }).catch(function(e) {
            showSettingsToast("Error: " + (e.message || e));
            loadInstalledSkills();
          });
        });
      });
      // Bind uninstall buttons
      skGrid.querySelectorAll(".sk-uninstall-btn").forEach(function(el) {
        el.addEventListener("click", async function() {
          var name = el.getAttribute("data-skill");
          if (!(await window.klausDialog.confirm({ message: tt("settings_skills_uninstall") + ": " + name + "?", danger: true }))) return;
          el.disabled = true;
          fetch("/api/skills/installed/" + encodeURIComponent(name), { method: "DELETE", credentials: "same-origin" }).then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function() {
            showSettingsToast(tt("settings_skills_uninstalled_toast"));
            loadAllSkillData();
          }).catch(function(e) {
            showSettingsToast("Error: " + (e.message || e));
            loadAllSkillData();
          });
        });
      });
    }
  }

  function loadMarketSkills() {
    return fetch("/api/skills/market", { credentials: "same-origin" }).then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function(data) {
      skMarketData = data.skills || [];
    }).catch(function(e) { console.error("Failed to load market skills:", e); });
  }

  function loadInstalledSkills() {
    return fetch("/api/skills", { credentials: "same-origin" }).then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function(data) {
      var all = data.skills || [];
      skBuiltinData = all.filter(function(s) { return s.always; });
      skInstalledData = all.filter(function(s) { return !s.always; });
    }).catch(function(e) { console.error("Failed to load skills:", e); });
  }

  function loadAllSkillData() {
    Promise.all([loadMarketSkills(), loadInstalledSkills()]).then(function() {
      updateSkillTabCounts();
      renderSkillCards();
    });
  }

  function updateSkillTabCounts() {
    var marketCount = skMarketData.length;
    var builtinCount = skBuiltinData.length;
    var installedCount = skInstalledData.length;
    var enabledCount = skInstalledData.filter(function(s) { return s.userEnabled; }).length;
    var disabledCount = skInstalledData.filter(function(s) { return !s.userEnabled; }).length;
    document.querySelectorAll(".sk-tab").forEach(function(t) {
      var f = t.getAttribute("data-sk-filter");
      var count = f === "market" ? marketCount : f === "builtin" ? builtinCount : f === "installed" ? installedCount : f === "enabled" ? enabledCount : disabledCount;
      if (!t.getAttribute("data-label")) t.setAttribute("data-label", t.textContent.replace(/ \d+$/, "").trim());
      t.textContent = t.getAttribute("data-label") + " " + count;
    });
  }

  // Tab filter buttons
  document.querySelectorAll(".sk-tab").forEach(function(t) {
    t.addEventListener("click", function() {
      document.querySelectorAll(".sk-tab").forEach(function(b) { b.classList.remove("active"); });
      t.classList.add("active");
      skFilter = t.getAttribute("data-sk-filter");
      renderSkillCards();
    });
  });

  // Search
  skSearch.addEventListener("input", function() { renderSkillCards(); });

  // Upload modal
  var skUploadModal = document.getElementById("sk-upload-modal");
  var skDropzone = document.getElementById("sk-dropzone");
  var skFileInput = document.getElementById("sk-file-input");
  var skUploadStatus = document.getElementById("sk-upload-status");

  document.getElementById("sk-upload-btn").addEventListener("click", function() {
    skUploadModal.classList.add("show");
    skUploadStatus.style.display = "none";
  });
  document.getElementById("sk-upload-close").addEventListener("click", function() {
    skUploadModal.classList.remove("show");
  });
  skUploadModal.addEventListener("click", function(e) {
    if (e.target === skUploadModal) skUploadModal.classList.remove("show");
  });

  skDropzone.addEventListener("click", function() { skFileInput.click(); });
  skDropzone.addEventListener("dragover", function(e) { e.preventDefault(); skDropzone.classList.add("drag-over"); });
  skDropzone.addEventListener("dragleave", function() { skDropzone.classList.remove("drag-over"); });
  skDropzone.addEventListener("drop", function(e) {
    e.preventDefault();
    skDropzone.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) uploadSkillFile(e.dataTransfer.files[0]);
  });
  skFileInput.addEventListener("change", function() {
    if (skFileInput.files.length > 0) uploadSkillFile(skFileInput.files[0]);
    skFileInput.value = "";
  });

  function uploadSkillFile(file) {
    skUploadStatus.style.display = "";
    skUploadStatus.textContent = tt("settings_skills_uploading");
    fetch("/api/skills/install?name=" + encodeURIComponent(file.name), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    }).then(function(r) { return r.json(); }).then(function(data) {
      if (data.ok) {
        skUploadStatus.textContent = tt("settings_skills_installed_toast") + ": " + data.name;
        loadAllSkillData();
      } else {
        skUploadStatus.textContent = "Error: " + (data.error || "unknown");
      }
    }).catch(function(e) {
      skUploadStatus.textContent = "Error: " + (e.message || e);
    });
  }

`;
}
