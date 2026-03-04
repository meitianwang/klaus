/**
 * Chat UI HTML template for the web channel.
 * Returns a complete HTML document with embedded CSS and JS.
 */

export function getChatHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Klaus AI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #ffffff;
  --fg: #0f172a;
  --msg-user: #f1f5f9;
  --msg-bot: #ffffff;
  border-radius: 20px;
  --border: #e2e8f0;
  --input-container: #ffffff;
  --input-border: #cbd5e1;
  --input-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.025);
  --accent: #020617;
  --accent-text: #ffffff;
  --accent-hover: #334155;
  --code-bg: #f8fafc;
  --thinking: #64748b;
  --preview-bg: #f1f5f9;
  --font-main: 'Inter', -apple-system, sans-serif;
  --avatar-user: #e2e8f0;
  --avatar-bot: #0f172a;
}
@media(prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #f8fafc;
    --msg-user: #1e293b;
    --msg-bot: #0f172a;
    --border: #334155;
    --input-container: #1e293b;
    --input-border: #475569;
    --input-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
    --accent: #f8fafc;
    --accent-text: #0f172a;
    --accent-hover: #e2e8f0;
    --code-bg: #0b1120;
    --thinking: #94a3b8;
    --preview-bg: #1e293b;
    --avatar-user: #334155;
    --avatar-bot: #f8fafc;
  }
}
html, body { height: 100%; font-family: var(--font-main); background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }
#app { display: flex; flex-direction: column; height: 100%; position: relative; }
#header { padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: rgba(var(--bg), 0.8); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); z-index: 10; }
.brand { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 8px; }
.brand-icon { width: 24px; height: 24px; background: var(--fg); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 14px; font-weight: bold; }
#status { font-size: 13px; font-weight: 500; color: #10b981; display: flex; align-items: center; gap: 6px; }
#status::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
#status.disconnected { color: #ef4444; }
#status.disconnected::before { background: #ef4444; }
#messages { flex: 1; overflow-y: auto; padding: 32px 16px; display: flex; flex-direction: column; gap: 32px; scroll-behavior: smooth; }
.msg-container { display: flex; gap: 16px; max-width: 800px; width: 100%; margin: 0 auto; animation: fade-in 0.3s ease-out; }
.msg-container.user { flex-direction: row-reverse; }
@keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.avatar { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; }
.msg-container.user .avatar { background: var(--avatar-user); color: var(--fg); }
.msg-container.assistant .avatar { background: var(--avatar-bot); color: var(--bg); }
.msg { padding: 14px 18px; border-radius: 20px; font-size: 15px; line-height: 1.6; word-wrap: break-word; white-space: pre-wrap; font-weight: 400; max-width: 85%; box-shadow: 0 1px 2px rgba(0,0,0,0.02); }
.msg.user { background: var(--msg-user); border-top-right-radius: 4px; }
.msg.assistant { background: var(--msg-bot); border-top-left-radius: 4px; border: 1px solid var(--border); }
.msg.error { background: #fee2e2; color: #991b1b; display: flex; align-items: center; gap: 8px; font-size: 14px; border-radius: 12px; max-width: fit-content; margin: 0 auto; padding: 12px 16px; border: 1px solid #fca5a5; }
.msg code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13.5px; background: var(--code-bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); }
.msg pre { background: var(--code-bg); padding: 16px; border-radius: 12px; border: 1px solid var(--border); overflow-x: auto; margin: 12px 0; }
.msg pre code { background: none; padding: 0; border: none; }
.msg a { color: #3b82f6; text-decoration: none; font-weight: 500; }
.msg a:hover { text-decoration: underline; }
.msg img { max-width: 100%; border-radius: 12px; margin: 8px 0; border: 1px solid var(--border); }
.file-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--code-bg); border: 1px solid var(--border); padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 500; margin: 4px; }
.thinking { color: var(--thinking); font-size: 14px; display: flex; align-items: center; gap: 8px; margin-top: 8px; font-weight: 500; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--thinking); border-bottom-color: transparent; border-radius: 50%; display: inline-block; animation: rotation 1s linear infinite; }
@keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
#input-wrapper { max-width: 800px; width: 100%; margin: 0 auto; padding: 0 16px 24px; }
#input-area { background: var(--input-container); border: 1px solid var(--input-border); border-radius: 24px; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--input-shadow); transition: border-color 0.2s, box-shadow 0.2s; }
#input-area:focus-within { border-color: var(--thinking); box-shadow: 0 0 0 2px rgba(100, 116, 139, 0.1), var(--input-shadow); }
#previews { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 4px; }
#previews:empty { display: none; }
.preview-item { position: relative; border-radius: 12px; overflow: hidden; background: var(--preview-bg); border: 1px solid var(--border); display: flex; align-items: center; }
.preview-item img { display: block; height: 64px; width: 64px; object-fit: cover; }
.preview-item .file-info { padding: 8px 12px; font-size: 12px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.preview-item .remove { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 50%; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: background 0.2s; }
.preview-item .remove:hover { background: rgba(0,0,0,0.8); }
.input-row { display: flex; gap: 10px; align-items: flex-end; }
#attach { background: transparent; border: none; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--thinking); flex-shrink: 0; transition: background 0.2s, color 0.2s; margin-bottom: 2px; }
#attach:hover { background: var(--preview-bg); color: var(--fg); }
#attach svg { width: 20px; height: 20px; stroke-width: 2; }
#input { flex: 1; resize: none; border: none; background: transparent; color: var(--fg); max-height: 200px; min-height: 40px; line-height: 1.5; outline: none; font-family: inherit; font-size: 15px; padding: 8px 0; }
#input::placeholder { color: var(--thinking); }
#send { background: var(--accent); color: var(--accent-text); border: none; border-radius: 50%; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, transform 0.1s; margin-bottom: 1px; }
#send:hover:not(:disabled) { background: var(--accent-hover); }
#send:active:not(:disabled) { transform: scale(0.95); }
#send:disabled { opacity: 0.5; cursor: not-allowed; }
#send svg { width: 18px; height: 18px; stroke-width: 2.5; margin-left: 2px; }
.drop-overlay { position: fixed; inset: 0; background: rgba(var(--bg), 0.8); backdrop-filter: blur(4px); border: 3px dashed var(--thinking); z-index: 100; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--fg); font-weight: 600; font-size: 20px; pointer-events: none; border-radius: 20px; margin: 16px; }
.drop-icon { width: 64px; height: 64px; color: var(--thinking); }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--thinking); }
</style>
</head>
<body>
<div id="app">
  <div id="header">
    <div class="brand">
      <div class="brand-icon">K</div>
      Klaus AI
    </div>
    <span id="status">connected</span>
  </div>
  <div id="messages"></div>
  <div id="input-wrapper">
    <div id="input-area">
      <div id="previews"></div>
      <div class="input-row">
        <button id="attach" title="Attach file">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
        </button>
        <input type="file" id="file-input" multiple hidden accept="image/*,audio/*,video/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.h,.yaml,.yml,.toml,.log,.sh,.bat">
        <textarea id="input" rows="1" placeholder="Send a message to Klaus..." autocomplete="off"></textarea>
        <button id="send" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>
        </button>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
  const token = new URLSearchParams(location.search).get("token");
  if (!token) { document.body.innerHTML = "<p style='padding:40px;text-align:center'>Missing token parameter.</p>"; return; }

  const msgs = document.getElementById("messages");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const statusEl = document.getElementById("status");
  const attachBtn = document.getElementById("attach");
  const fileInput = document.getElementById("file-input");
  const previewsEl = document.getElementById("previews");
  let busy = false;

  const pendingFiles = [];

  input.addEventListener("input", function(){
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 200) + "px";
    updateBtn();
  });

  const es = new EventSource("/api/events?token="+encodeURIComponent(token));
  es.onopen = () => { statusEl.textContent = "Connected"; statusEl.className = ""; };
  es.onerror = () => { statusEl.textContent = "Reconnecting..."; statusEl.className = "disconnected"; };
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "ping") return;
    removeThinking();
    if (data.type === "message") { appendMsg("assistant", data.text); busy = false; updateBtn(); }
    else if (data.type === "merged") { busy = false; updateBtn(); }
    else if (data.type === "error") { appendErrorMsg(data.message); busy = false; updateBtn(); }
  };

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files) addFiles(Array.from(fileInput.files));
    fileInput.value = "";
  });

  function addFiles(files) {
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { appendErrorMsg("File too large (max 10 MB): " + f.name); continue; }
      const entry = { file: f, objectUrl: null, uploadId: null, uploading: true };
      if (f.type.startsWith("image/")) entry.objectUrl = URL.createObjectURL(f);
      pendingFiles.push(entry);
      uploadFile(entry);
    }
    renderPreviews();
    updateBtn();
  }

  async function uploadFile(entry) {
    try {
      const res = await fetch("/api/upload?token=" + encodeURIComponent(token) + "&name=" + encodeURIComponent(entry.file.name), {
        method: "POST",
        headers: { "Content-Type": entry.file.type || "application/octet-stream" },
        body: entry.file
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      entry.uploadId = data.id;
    } catch(err) {
      appendErrorMsg("Upload failed: " + entry.file.name);
      const idx = pendingFiles.indexOf(entry);
      if (idx >= 0) pendingFiles.splice(idx, 1);
    }
    entry.uploading = false;
    renderPreviews();
    updateBtn();
  }

  function removeFile(idx) {
    const entry = pendingFiles[idx];
    if (entry && entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    pendingFiles.splice(idx, 1);
    renderPreviews();
    updateBtn();
  }

  function renderPreviews() {
    previewsEl.innerHTML = "";
    pendingFiles.forEach((entry, i) => {
      const wrap = document.createElement("div");
      wrap.className = "preview-item";
      if (entry.objectUrl) {
        const img = document.createElement("img");
        img.src = entry.objectUrl;
        wrap.appendChild(img);
      } else {
        const info = document.createElement("div");
        info.className = "file-info";
        info.textContent = (entry.uploading ? "Uploading... " : "") + entry.file.name;
        wrap.appendChild(info);
      }
      const rm = document.createElement("button");
      rm.className = "remove";
      rm.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      rm.onclick = () => removeFile(i);
      wrap.appendChild(rm);
      previewsEl.appendChild(wrap);
    });
  }

  let dragCount = 0;
  let dropOverlay = null;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCount++;
    if (dragCount === 1) showDropOverlay();
  });
  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCount--;
    if (dragCount <= 0) { dragCount = 0; hideDropOverlay(); }
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCount = 0;
    hideDropOverlay();
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
  });
  function showDropOverlay() {
    if (dropOverlay) return;
    dropOverlay = document.createElement("div");
    dropOverlay.className = "drop-overlay";
    dropOverlay.innerHTML = '<svg class="drop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>Drop files to upload';
    document.body.appendChild(dropOverlay);
  }
  function hideDropOverlay() {
    if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; }
  }

  input.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  async function send() {
    const text = input.value.trim();
    const hasFiles = pendingFiles.length > 0;
    if ((!text && !hasFiles) || busy) return;
    if (pendingFiles.some(e => e.uploading)) return;

    const fileNames = pendingFiles.map(e => e.file.name);
    const imageUrls = pendingFiles.filter(e => e.objectUrl).map(e => e.objectUrl);
    const nonImageFiles = pendingFiles.filter(e => !e.objectUrl).map(e => e.file.name);
    
    appendUserMsg(text, imageUrls, nonImageFiles);

    const fileIds = pendingFiles.map(e => e.uploadId).filter(Boolean);
    pendingFiles.length = 0;
    renderPreviews();

    input.value = ""; input.style.height = "auto";
    busy = true; updateBtn(); showThinking();
    try {
      const body = { token, text };
      if (fileIds.length) body.files = fileIds;
      const res = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) { const d = await res.json().catch(()=>({})); appendErrorMsg(d.error||"Request failed"); removeThinking(); busy=false; updateBtn(); }
    } catch(err) { appendErrorMsg("Network error"); removeThinking(); busy=false; updateBtn(); }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { 
    if (e.key==="Enter" && !e.shiftKey) { 
      // check if it's on mobile, usually shiftKey isn't easy there, but let's just do standard enter to send
      e.preventDefault(); send(); 
    } 
  });

  function updateBtn() {
    const uploading = pendingFiles.some(e => e.uploading);
    const text = input.value.trim();
    const hasFiles = pendingFiles.length > 0;
    sendBtn.disabled = busy || uploading || (!text && !hasFiles);
  }

  function showThinking() {
    if (document.getElementById("thinking-container")) return;
    const el = document.createElement("div");
    el.className = "msg-container assistant";
    el.id = "thinking-container";
    el.innerHTML = '<div class="avatar">K</div><div class="msg assistant"><div class="thinking"><div class="spinner"></div>Thinking...</div></div>';
    msgs.appendChild(el); scrollBottom();
  }
  function removeThinking() { 
    const el = document.getElementById("thinking-container"); 
    if (el) el.remove(); 
  }

  function appendUserMsg(text, imageUrls, fileNames) {
    const wrap = document.createElement("div");
    wrap.className = "msg-container user";
    
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "U";
    wrap.appendChild(avatar);

    const el = document.createElement("div");
    el.className = "msg user";
    
    let html = "";
    if (imageUrls.length) {
      html += imageUrls.map(u => '<img src="' + escAttr(u) + '">').join("");
    }
    if (fileNames.length) {
      html += fileNames.map(n => '<span class="file-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>' + escHtml(n) + '</span>').join(" ");
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

  function appendMsg(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "msg-container " + role;
    
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? "U" : "K";
    wrap.appendChild(avatar);

    const el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = role === "user" ? escHtml(text) : renderMd(text);
    
    wrap.appendChild(el);
    msgs.appendChild(wrap); 
    scrollBottom();
  }

  function appendErrorMsg(text) {
    const el = document.createElement("div");
    el.className = "msg error";
    el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' + escHtml(text);
    msgs.appendChild(el); scrollBottom();
  }

  function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

  function escHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function escAttr(s) { return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function renderMd(text) {
    text = escHtml(text);
    text = text.replace(/\\\`\\\`\\\`(\\w*)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, (_,lang,code) =>
      "<pre><code>" + code.replace(/\\n$/,"") + "</code></pre>");
    text = text.replace(/\\\`([^\\\`]+)\\\`/g, (_,c) => "<code>"+c+"</code>");
    text = text.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    text = text.replace(/(?:^|[^*])\\*([^*]+)\\*(?:[^*]|$)/g, (m,c) =>
      m.replace("*"+c+"*", "<em>"+c+"</em>"));
    text = text.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const parts = text.split(/(<pre>[\\s\\S]*?<\\/pre>)/g);
    return parts.map((p,i) => i%2===0 ? p.replace(/\\n/g,"<br>") : p).join("");
  }
})();
</script>
</body>
</html>`;
}
