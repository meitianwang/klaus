/** Chat UI: file upload, message sending, rendering, tool display. */

export function getMessagesJs(): string {
  return `
  attachBtn.addEventListener("click", function() { fileInput.click(); });
  fileInput.addEventListener("change", function() {
    if (fileInput.files) addFiles(Array.from(fileInput.files));
    fileInput.value = "";
  });

  function addFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.size > 10 * 1024 * 1024) { appendErrorMsg(tt("file_too_large") + f.name); continue; }
      var entry = { file: f, objectUrl: null, uploadId: null, uploading: true };
      if (f.type.startsWith("image/")) entry.objectUrl = URL.createObjectURL(f);
      pendingFiles.push(entry);
      uploadFile(entry);
    }
    renderPreviews();
    updateBtn();
  }

  async function uploadFile(entry) {
    try {
      var res = await fetch("/api/upload?name=" + encodeURIComponent(entry.file.name), {
        method: "POST",
        headers: { "Content-Type": entry.file.type || "application/octet-stream" },
        body: entry.file
      });
      if (!res.ok) throw new Error("Upload failed");
      var data = await res.json();
      entry.uploadId = data.id;
    } catch(err) {
      appendErrorMsg(tt("upload_failed") + entry.file.name);
      var idx = pendingFiles.indexOf(entry);
      if (idx >= 0) pendingFiles.splice(idx, 1);
    }
    entry.uploading = false;
    renderPreviews();
    updateBtn();
  }

  function removeFile(idx) {
    var entry = pendingFiles[idx];
    if (entry && entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    pendingFiles.splice(idx, 1);
    renderPreviews();
    updateBtn();
  }

  function renderPreviews() {
    previewsEl.innerHTML = "";
    pendingFiles.forEach(function(entry, i) {
      var wrap = document.createElement("div");
      wrap.className = "preview-item";
      if (entry.objectUrl) {
        var img = document.createElement("img");
        img.src = entry.objectUrl;
        wrap.appendChild(img);
      } else {
        var info = document.createElement("div");
        info.className = "file-info";
        info.textContent = (entry.uploading ? tt("uploading") : "") + entry.file.name;
        wrap.appendChild(info);
      }
      var rm = document.createElement("button");
      rm.className = "remove";
      rm.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      rm.onclick = function() { removeFile(i); };
      wrap.appendChild(rm);
      previewsEl.appendChild(wrap);
    });
  }

  var dragCount = 0;
  var dropOverlay = null;
  document.addEventListener("dragenter", function(e) {
    e.preventDefault();
    dragCount++;
    if (dragCount === 1) showDropOverlay();
  });
  document.addEventListener("dragleave", function(e) {
    e.preventDefault();
    dragCount--;
    if (dragCount <= 0) { dragCount = 0; hideDropOverlay(); }
  });
  document.addEventListener("dragover", function(e) { e.preventDefault(); });
  document.addEventListener("drop", function(e) {
    e.preventDefault();
    dragCount = 0;
    hideDropOverlay();
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
  });
  function showDropOverlay() {
    if (dropOverlay) return;
    dropOverlay = document.createElement("div");
    dropOverlay.className = "drop-overlay";
    dropOverlay.innerHTML = '<svg class="drop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>' + tt("drop_files");
    document.body.appendChild(dropOverlay);
  }
  function hideDropOverlay() {
    if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
  }

  input.addEventListener("paste", function(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        var f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  async function send() {
    var text = input.value.trim();
    var hasFiles = pendingFiles.length > 0;
    if ((!text && !hasFiles) || busy) return;
    if (pendingFiles.some(function(e) { return e.uploading; })) return;

    hideWelcome();

    var imageUrls = pendingFiles.filter(function(e) { return e.objectUrl; }).map(function(e) { return e.objectUrl; });
    var nonImageFiles = pendingFiles.filter(function(e) { return !e.objectUrl; }).map(function(e) { return e.file.name; });

    if (isSlashCommand(text)) {
      appendSystemCmd(text);
    } else {
      appendUserMsg(text, imageUrls, nonImageFiles);
    }

    var fileIds = pendingFiles.map(function(e) { return e.uploadId; }).filter(Boolean);
    pendingFiles.length = 0;
    renderPreviews();

    input.value = ""; input.style.height = "auto";
    busy = true; updateBtn(); showThinking();
    updateSessionTitle(text);
    if (ws && ws.readyState === WebSocket.OPEN) {
      var msg = { type: "message", text: text, sessionId: currentSessionId };
      if (fileIds.length) msg.files = fileIds;
      ws.send(JSON.stringify(msg));
    } else {
      appendErrorMsg(tt("not_connected")); removeThinking(); busy = false; updateBtn();
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); send();
    }
  });

  function updateBtn() {
    var uploading = pendingFiles.some(function(e) { return e.uploading; });
    var text = input.value.trim();
    var hasFiles = pendingFiles.length > 0;
    sendBtn.disabled = busy || uploading || (!text && !hasFiles);
  }

  var thinkingScrollTimer = null;

  function showThinking(chunk) {
    var el = document.getElementById("thinking-container");
    if (!el) {
      el = document.createElement("div");
      el.className = "thinking-indicator";
      el.id = "thinking-container";
      el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label">' + tt("thinking") + '</span><div class="thinking-content"></div>';
      msgs.appendChild(el);
      scrollBottom();
    }
    if (chunk) {
      var contentEl = el.querySelector(".thinking-content");
      if (contentEl) {
        contentEl.style.display = "block";
        // Append text node instead of replacing textContent to avoid full reflow
        contentEl.appendChild(document.createTextNode(chunk));
        // Throttle scrollBottom to avoid layout thrashing
        if (!thinkingScrollTimer) {
          thinkingScrollTimer = setTimeout(function() { thinkingScrollTimer = null; scrollBottom(); }, 150);
        }
      }
    }
  }

  function removeThinking() {
    var el = document.getElementById("thinking-container");
    if (el) el.remove();
    if (thinkingScrollTimer) { clearTimeout(thinkingScrollTimer); thinkingScrollTimer = null; }
  }

  var activeTools = new Map();
  var agentContainers = new Map();
  var toolContainer = null;

  var toolIcons = {
    terminal: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 9l3 3-3 3"/><path d="M13 15h3"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>',
    file: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    "file-plus": '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    edit: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    search: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    globe: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    list: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    agent: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-9-11h2m18 0h2m-3.64-6.36l-1.42 1.42M6.34 17.66l-1.42 1.42m0-13.08l1.42 1.42m11.32 11.32l1.42 1.42"/></svg>',
    tool: '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
  };

  function getOrCreateToolContainer() {
    if (toolContainer && document.contains(toolContainer)) return toolContainer;
    toolContainer = document.createElement("div");
    toolContainer.className = "tool-container";
    toolContainer.id = "active-tools";
    var thinking = document.getElementById("thinking-container");
    if (thinking) {
      msgs.insertBefore(toolContainer, thinking);
    } else {
      msgs.appendChild(toolContainer);
    }
    return toolContainer;
  }

  function clearToolContainer() {
    var tc = document.getElementById("active-tools");
    if (tc) tc.remove();
    toolContainer = null;
    activeTools.clear();
    agentContainers.clear();
  }

  function createAgentContainer(te, parentContainer) {
    var agentWrap = document.createElement("div");
    agentWrap.className = "agent-container";
    var header = document.createElement("div");
    header.className = "agent-header";
    var iconHtml = toolIcons.agent || "";
    header.innerHTML = '<span class="agent-toggle">&#9660;</span>' + iconHtml
      + '<span class="tool-label">' + escHtml(te.display.label) + '</span>'
      + (te.display.value ? '<span class="tool-value">' + escHtml(te.display.value) + '</span>' : '')
      + '<span class="tool-dot"></span>';
    header.onclick = function() {
      var toggle = header.querySelector(".agent-toggle");
      var children = agentWrap.querySelector(".agent-children");
      if (!toggle || !children) return;
      if (children.classList.contains("collapsed")) {
        children.classList.remove("collapsed");
        toggle.classList.remove("collapsed");
      } else {
        children.classList.add("collapsed");
        toggle.classList.add("collapsed");
      }
    };
    var childrenEl = document.createElement("div");
    childrenEl.className = "agent-children";
    agentWrap.appendChild(header);
    agentWrap.appendChild(childrenEl);
    parentContainer.appendChild(agentWrap);
    agentContainers.set(te.toolUseId, { container: agentWrap, childrenEl: childrenEl, headerEl: header });
    activeTools.set(te.toolUseId, { element: header, toolName: te.toolName, isAgent: true });
    scrollBottom();
  }

  function createToolItem(te, parentContainer) {
    var el = document.createElement("div");
    el.className = "tool-item " + (te.display.style || "default");
    el.id = "tool-" + te.toolUseId;
    var iconKey = Object.prototype.hasOwnProperty.call(toolIcons, te.display.icon) ? te.display.icon : "tool";
    var html = toolIcons[iconKey];
    html += '<span class="tool-label">' + escHtml(te.display.label) + '</span>';
    if (te.display.value) {
      var cls = te.display.style === "terminal" ? "tool-value terminal-cmd" : "tool-value";
      var prefix = te.display.style === "terminal" ? "$ " : "";
      html += '<span class="' + cls + '">' + prefix + escHtml(te.display.value) + '</span>';
    }
    if (te.display.secondary) {
      html += '<span class="tool-secondary">' + escHtml(te.display.secondary) + '</span>';
    }
    html += '<span class="tool-dot"></span>';
    el.innerHTML = html;
    parentContainer.appendChild(el);
    activeTools.set(te.toolUseId, { element: el, toolName: te.toolName });
    scrollBottom();
  }

  function handleToolResult(te) {
    var tracked = activeTools.get(te.toolUseId);
    if (!tracked) return;
    var dot = tracked.element.querySelector(".tool-dot");
    if (dot) dot.remove();
    if (te.isError) {
      tracked.element.classList.add("error");
      var errSpan = document.createElement("span");
      errSpan.className = "tool-secondary";
      errSpan.style.color = "#dc2626";
      errSpan.textContent = tt("error");
      tracked.element.appendChild(errSpan);
    } else {
      tracked.element.classList.add("done");
    }
    if (tracked.isAgent) {
      var agentInfo = agentContainers.get(te.toolUseId);
      if (agentInfo) agentInfo.container.classList.add("done");
    }
    activeTools.delete(te.toolUseId);
  }

  function handleToolEvent(te) {
    if (!te) return;
    if (te.type === "tool_start") {
      var parentContainer = (te.parentToolUseId && agentContainers.has(te.parentToolUseId))
        ? agentContainers.get(te.parentToolUseId).childrenEl
        : getOrCreateToolContainer();
      if (te.toolName === "Agent") { createAgentContainer(te, parentContainer); }
      else { createToolItem(te, parentContainer); }
    }
    if (te.type === "tool_result") { handleToolResult(te); }
    if (te.type === "tool_input") {
      // Streaming tool input JSON delta — update the tool's value display
      var tracked = activeTools.get(te.toolUseId);
      if (tracked && tracked.element) {
        var valEl = tracked.element.querySelector(".tool-value");
        if (valEl) {
          var cur = valEl.getAttribute("data-raw-input") || "";
          cur += te.delta || "";
          valEl.setAttribute("data-raw-input", cur);
          // Show truncated preview of the accumulating input
          var preview = cur.length > 120 ? cur.slice(0, 120) + "..." : cur;
          valEl.textContent = preview;
        }
      }
    }
    if (te.type === "tool_progress") {
      // Bash/tool progress output — show below the tool item
      var tracked2 = activeTools.get(te.toolUseId);
      if (tracked2 && tracked2.element) {
        var progEl = tracked2.element.querySelector(".tool-progress");
        if (!progEl) {
          progEl = document.createElement("div");
          progEl.className = "tool-progress";
          tracked2.element.appendChild(progEl);
        }
        // Keep last 500 chars of progress
        var existing = progEl.textContent || "";
        var combined = existing + (te.content || "");
        if (combined.length > 500) combined = combined.slice(-500);
        progEl.textContent = combined;
        scrollBottom();
      }
    }
  }

  function appendSystemNotice(text) {
    var el = document.createElement("div");
    el.className = "system-notice";
    el.textContent = text;
    msgs.appendChild(el);
    scrollBottom();
    // Auto-remove after 8 seconds
    setTimeout(function() { if (el.parentNode) el.remove(); }, 8000);
  }

  var streamBuffer = "";
  var streamFullText = "";
  var streamTimer = null;
  var isStreaming = false;

  function handleStreamChunk(chunk) {
    if (!isStreaming) {
      removeThinking();
      clearToolContainer();
      createStreamingMessage();
      isStreaming = true;
    }
    streamBuffer += chunk;
    streamFullText += chunk;
    if (!streamTimer) {
      streamTimer = setTimeout(flushStreamBuffer, 100);
    }
  }

  function flushStreamBuffer() {
    streamTimer = null;
    if (!streamBuffer) return;
    streamBuffer = "";
    var el = document.getElementById("streaming-msg");
    if (!el) return;
    var msgEl = el.querySelector(".msg");
    if (!msgEl) return;
    var rendered = renderMd(streamFullText);
    msgEl.innerHTML = rendered + '<span class="cursor"></span>';
    scrollBottom();
  }

  function createStreamingMessage() {
    hideWelcome();
    var wrap = document.createElement("div");
    wrap.className = "msg-group assistant";
    wrap.id = "streaming-msg";
    wrap.innerHTML = '<div class="msg-label">' + escHtml(tt("bot_name")) + '</div><div class="msg assistant streaming"><span class="cursor"></span></div>';
    msgs.appendChild(wrap);
    scrollBottom();
  }

  function finalizeStreamingMessage(fullText) {
    if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
    if (streamBuffer) { flushStreamBuffer(); }
    streamBuffer = "";
    streamFullText = "";
    isStreaming = false;
    var el = document.getElementById("streaming-msg");
    if (el) {
      if (fullText) {
        var msgEl = el.querySelector(".msg");
        if (msgEl) { msgEl.className = "msg assistant"; msgEl.innerHTML = renderMd(fullText); postProcessMsg(msgEl); }
      } else {
        var cursor = el.querySelector(".cursor");
        if (cursor) cursor.remove();
        var msgEl2 = el.querySelector(".msg");
        if (msgEl2) msgEl2.classList.remove("streaming");
      }
      el.removeAttribute("id");
    }
    scrollBottom();
  }

  function appendUserMsg(text, imageUrls, nonImageFiles) {
    hideWelcome();
    var wrap = document.createElement("div");
    wrap.className = "msg-group user";

    var el = document.createElement("div");
    el.className = "msg user";

    var html = "";
    if (imageUrls.length) {
      html += imageUrls.map(function(u) { return '<img src="' + escAttr(u) + '">'; }).join("");
    }
    if (nonImageFiles.length) {
      html += nonImageFiles.map(function(n) { return '<span class="file-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>' + escHtml(n) + '</span>'; }).join(" ");
    }
    if (text) {
      if (html) html += "<br>";
      html += escHtml(text);
    }

    el.innerHTML = html;
    wrap.appendChild(el);
    msgs.appendChild(wrap);
    scrollBottom();
  }

  var fileBadgeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
  var imageBadgeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';

  function renderUserHistory(text) {
    var badges = [];
    var clean = text.replace(/\\[文件: (.+?)\\]/g, function(_, name) {
      badges.push('<span class="file-badge">' + fileBadgeSvg + ' ' + escHtml(name) + '</span>');
      return "";
    });
    clean = clean.replace(/\\[图片: (.+?)\\]/g, function(_, name) {
      badges.push('<span class="file-badge">' + imageBadgeSvg + ' ' + escHtml(name) + '</span>');
      return "";
    });
    clean = clean.replace(/\\[图片\\]/g, function() {
      badges.push('<span class="file-badge">' + imageBadgeSvg + ' 图片</span>');
      return "";
    });
    clean = clean.replace(/\\[语音: "(.+?)"\\]/g, function(_, transcript) {
      badges.push('<span class="file-badge">🎤 ' + escHtml(transcript) + '</span>');
      return "";
    });
    clean = clean.replace(/\\[语音消息\\]/g, function() {
      badges.push('<span class="file-badge">🎤 语音消息</span>');
      return "";
    });
    clean = clean.replace(/\\[视频\\]/g, function() {
      badges.push('<span class="file-badge">🎬 视频</span>');
      return "";
    });
    clean = clean.trim();
    var html = badges.join(" ");
    if (clean) {
      if (html) html += "<br>";
      html += escHtml(clean);
    }
    return html;
  }

  function appendMsg(role, text) {
    hideWelcome();
    var wrap = document.createElement("div");
    wrap.className = "msg-group " + role;

    if (role === "assistant") {
      var label = document.createElement("div");
      label.className = "msg-label";
      label.textContent = tt("bot_name");
      wrap.appendChild(label);
    }

    var el = document.createElement("div");
    el.className = "msg " + role;
    if (role === "user") {
      el.innerHTML = renderUserHistory(text);
    } else {
      el.innerHTML = renderMd(text);
      postProcessMsg(el);
    }

    wrap.appendChild(el);
    msgs.appendChild(wrap);
    scrollBottom();
  }

  function appendErrorMsg(text) {
    hideWelcome();
    var el = document.createElement("div");
    el.className = "msg error";
    el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' + escHtml(text);
    msgs.appendChild(el); scrollBottom();
  }

  var FILE_EXT_LABELS = { pdf: "PDF", json: "JSON", zip: "ZIP", gz: "GZ", txt: "TXT", csv: "CSV", md: "MD", html: "HTML", png: "PNG", jpg: "JPG", jpeg: "JPG", gif: "GIF", webp: "WEBP", svg: "SVG", mp3: "MP3", wav: "WAV", mp4: "MP4", webm: "WEBM", py: "PY", ts: "TS", js: "JS", sh: "SH" };
  function appendFileCard(name, url) {
    hideWelcome();
    var ext = (name.split(".").pop() || "").toLowerCase();
    var label = FILE_EXT_LABELS[ext] || ext.toUpperCase() || "FILE";
    var wrap = document.createElement("div");
    wrap.className = "msg-group assistant";
    var nameLabel = document.createElement("div");
    nameLabel.className = "msg-label";
    nameLabel.textContent = tt("bot_name");
    wrap.appendChild(nameLabel);
    var card = document.createElement("div");
    card.className = "file-card";
    card.innerHTML = '<div class="file-card-icon">' + escHtml(label) + '</div>'
      + '<div class="file-card-info"><div class="file-card-name">' + escHtml(name) + '</div>'
      + '<div class="file-card-hint">' + tt("file_ready") + '</div></div>'
      + '<a class="file-card-dl" href="' + escHtml(url) + '" download="' + escHtml(name) + '">' + tt("download") + '</a>';
    wrap.appendChild(card);
    msgs.appendChild(wrap);
    scrollBottom();
  }

  var SLASH_COMMANDS = ["/new", "/reset", "/clear", "/help", "/session"];
  function isSlashCommand(text) {
    var lower = text.toLowerCase();
    return SLASH_COMMANDS.some(function(cmd) { return lower === cmd || lower.startsWith(cmd + " "); });
  }
  function appendSystemCmd(text) {
    hideWelcome();
    var el = document.createElement("div");
    el.className = "system-cmd";
    el.innerHTML = "<span>" + escHtml(text) + "</span>";
    msgs.appendChild(el); scrollBottom();
  }

  function showConfigNotification() {
    if (document.getElementById("config-banner")) return;
    var banner = document.createElement("div");
    banner.className = "config-banner";
    banner.id = "config-banner";
    banner.innerHTML = '<span style="font-size:16px">&#9888;&#65039;</span><span style="flex:1">' + tt("config_updated") + '</span>';
    var btn = document.createElement("button");
    btn.textContent = "\\u00d7";
    btn.onclick = function() { banner.remove(); };
    banner.appendChild(btn);
    document.body.appendChild(banner);
    setTimeout(function() { var el = document.getElementById("config-banner"); if (el) el.remove(); }, 15000);
  }

  function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

  function escHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function escAttr(s) { return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  var KNOWN_HTML_RE = /^\\/?(p|br|strong|em|b|i|u|s|code|pre|ol|ul|li|blockquote|h[1-6]|a|table|thead|tbody|tfoot|tr|th|td|del|hr|div|span|img|sup|sub|dl|dt|dd|details|summary)(\\s|>|\\/|\$)/i;
  var TOOL_TAGS = "bash|shell|execute|run_command|read_file|write_file|edit_file|search|grep|glob|find|file|tool_call|function_call|tool|command";
  var TOOL_BLOCK_RE = new RegExp("<(" + TOOL_TAGS + ")(\\\\s[^>]*)?>[\\\\s\\\\S]*?</\\\\1>", "gi");
  var TOOL_OPEN_RE = new RegExp("<\\/?("+TOOL_TAGS+")(\\\\s[^>]*)?>", "gi");
  function stripToolXml(s) {
    // Split on code fences and inline code to preserve code blocks
    var parts = s.split(/(\\\`\\\`\\\`[\\s\\S]*?\\\`\\\`\\\`|\\\`[^\\\`]+\\\`)/g);
    for (var k = 0; k < parts.length; k += 2) {
      parts[k] = parts[k].replace(TOOL_BLOCK_RE, "").replace(TOOL_OPEN_RE, "");
    }
    return parts.join("");
  }
  function escNonHtmlTags(s) {
    var parts = s.split(/(\\\`\\\`\\\`[\\s\\S]*?\\\`\\\`\\\`|\\\`[^\\\`]+\\\`)/g);
    for (var k = 0; k < parts.length; k += 2) {
      parts[k] = parts[k].replace(/<(\\/?)([a-zA-Z][\\w-]*)([\\s\\S]*?)>/g, function(m, slash, tag, rest) {
        if (KNOWN_HTML_RE.test((slash || "") + tag + rest.charAt(0))) return m;
        return "&lt;" + slash + tag + rest + "&gt;";
      });
    }
    return parts.join("");
  }

  function renderMd(text) {
    text = stripToolXml(text);
    if (typeof marked !== "undefined") {
      var html = marked.parse(escNonHtmlTags(text));
      var tmp = document.createElement("div");
      tmp.innerHTML = html;
      var SAFE = {P:1,BR:1,STRONG:1,EM:1,CODE:1,PRE:1,OL:1,UL:1,LI:1,BLOCKQUOTE:1,H1:1,H2:1,H3:1,H4:1,A:1,TABLE:1,THEAD:1,TBODY:1,TR:1,TH:1,TD:1,DEL:1,HR:1};
      (function sanitize(parent) {
        var i = parent.childNodes.length;
        while (i--) {
          var node = parent.childNodes[i];
          if (node.nodeType === 1) {
            if (!SAFE[node.tagName]) {
              var span = document.createTextNode(node.textContent || "");
              parent.replaceChild(span, node);
            } else {
              var attrs = node.attributes;
              for (var j = attrs.length - 1; j >= 0; j--) {
                var name = attrs[j].name;
                if (node.tagName === "A" && (name === "href" || name === "target" || name === "rel")) continue;
                node.removeAttribute(name);
              }
              if (node.tagName === "A") {
                var href = (node.getAttribute("href") || "").trim().toLowerCase();
                if (href && !/^(https?:|mailto:|\\/|#)/.test(href)) {
                  node.removeAttribute("href");
                }
              }
              sanitize(node);
            }
          }
        }
      })(tmp);
      return tmp.innerHTML;
    }
    text = escHtml(text);
    text = text.replace(/\\\`\\\`\\\`(\\w*)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, function(_,lang,code) {
      return "<pre><code>" + code.replace(/\\n$/,"") + "</code></pre>";
    });
    text = text.replace(/\\\`([^\\\`]+)\\\`/g, function(_,c) { return "<code>"+c+"</code>"; });
    text = text.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    text = text.replace(/(?:^|[^*])\\*([^*]+)\\*(?:[^*]|$)/g, function(m,c) {
      return m.replace("*"+c+"*", "<em>"+c+"</em>");
    });
    text = text.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    var parts = text.split(/(<pre>[\\s\\S]*?<\\/pre>)/g);
    return parts.map(function(p,i) { return i%2===0 ? p.replace(/\\n/g,"<br>") : p; }).join("");
  }


  function postProcessMsg(container) {
    container.querySelectorAll("pre code").forEach(function(block) {
      if (typeof hljs !== "undefined") hljs.highlightElement(block);
      var pre = block.parentElement;
      if (!pre || !pre.parentElement || pre.parentElement.classList.contains("code-block")) return;
      var wrapper = document.createElement("div");
      wrapper.className = "code-block";
      pre.parentElement.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      var langClass = Array.from(block.classList).find(function(c) { return c.startsWith("language-"); });
      var lang = langClass ? langClass.replace("language-", "") : "";
      if (lang && lang !== "plaintext") {
        var badge = document.createElement("span");
        badge.className = "code-lang";
        badge.textContent = lang;
        wrapper.appendChild(badge);
      }
      var btn = document.createElement("button");
      btn.className = "code-copy";
      btn.textContent = tt("copy");
      btn.onclick = function() {
        navigator.clipboard.writeText(block.textContent).then(function() {
          btn.textContent = tt("copied");
          setTimeout(function() { btn.textContent = tt("copy"); }, 2000);
        }).catch(function() { btn.textContent = tt("copy_failed"); setTimeout(function() { btn.textContent = tt("copy"); }, 2000); });
      };
      wrapper.appendChild(btn);
    });
    container.querySelectorAll("a").forEach(function(a) {
      if (!a.getAttribute("target")) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
    });
  }


`;
}
