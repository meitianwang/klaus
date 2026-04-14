/** Chat UI CSS styles. */

export function getChatCss(): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#ffffff;
  --bg-surface:#f8fafc;
  --bg-elevated:#ffffff;
  --bg-hover:#f1f5f9;
  --fg:#0f172a;
  --fg-secondary:#334155;
  --fg-tertiary:#64748b;
  --fg-quaternary:#94a3b8;
  --border:#e2e8f0;
  --border-subtle:#f1f5f9;
  --input-bg:#ffffff;
  --input-border:#cbd5e1;
  --input-focus:#94a3b8;
  --accent:#020617;
  --accent-text:#ffffff;
  --accent-hover:#334155;
  --code-bg:#f8fafc;
  --msg-user-bg:#f1f5f9;
  --font:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;
  --radius-sm:8px;
  --radius-md:16px;
  --radius-lg:24px;
  --radius-xl:28px;
  --shadow-lg:0 24px 48px -12px rgba(0,0,0,0.1);
  --shadow-md:0 8px 24px -4px rgba(0,0,0,0.06);
  --transition:150ms cubic-bezier(0.4,0,0.2,1);
}
[data-theme="dark"]{
  --bg:#0f172a;
  --bg-surface:#1e293b;
  --bg-elevated:#1e293b;
  --bg-hover:#334155;
  --fg:#f1f5f9;
  --fg-secondary:#cbd5e1;
  --fg-tertiary:#94a3b8;
  --fg-quaternary:#64748b;
  --border:#334155;
  --border-subtle:#1e293b;
  --input-bg:#1e293b;
  --input-border:#475569;
  --input-focus:#94a3b8;
  --accent:#e2e8f0;
  --accent-text:#0f172a;
  --accent-hover:#cbd5e1;
  --code-bg:#1e293b;
  --msg-user-bg:#1e293b;
  --shadow-lg:0 24px 48px -12px rgba(0,0,0,0.4);
  --shadow-md:0 8px 24px -4px rgba(0,0,0,0.3);
}
@media(prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0f172a;
    --bg-surface:#1e293b;
    --bg-elevated:#1e293b;
    --bg-hover:#334155;
    --fg:#f1f5f9;
    --fg-secondary:#cbd5e1;
    --fg-tertiary:#94a3b8;
    --fg-quaternary:#64748b;
    --border:#334155;
    --border-subtle:#1e293b;
    --input-bg:#1e293b;
    --input-border:#475569;
    --input-focus:#94a3b8;
    --accent:#e2e8f0;
    --accent-text:#0f172a;
    --accent-hover:#cbd5e1;
    --code-bg:#1e293b;
    --msg-user-bg:#1e293b;
    --shadow-lg:0 24px 48px -12px rgba(0,0,0,0.4);
    --shadow-md:0 8px 24px -4px rgba(0,0,0,0.3);
  }
}
html,body{height:100dvh;width:100vw;font-family:var(--font);background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow:hidden}
::selection{background:rgba(2,6,23,0.1)}
#app{display:flex;height:100%;width:100%;position:fixed;inset:0}

/* ─── Sidebar ─── */
.sidebar{
  width:260px;background:var(--bg);border-right:1px solid var(--border);
  display:flex;flex-direction:column;z-index:30;
  position:fixed;left:0;top:0;bottom:0;
  transform:translateX(-100%);transition:transform .25s ease,visibility 0s .25s,width .2s ease;
  visibility:hidden;pointer-events:none;
}
.sidebar.open{transform:translateX(0);visibility:visible;pointer-events:auto;transition:transform .25s ease,visibility 0s 0s,width .2s ease}
@media(min-width:769px){
  .sidebar{position:relative;transform:none!important;visibility:visible!important;pointer-events:auto!important;transition:width .2s ease}
  .sidebar.collapsed{width:60px}
}
.sidebar-header{padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
.sidebar.collapsed .sidebar-header{padding:14px 12px;justify-content:center}
.sidebar.collapsed .sidebar-brand{display:none}
.sidebar-toggle{
  width:32px;height:32px;border-radius:var(--radius-sm);
  background:transparent;border:none;
  color:var(--fg-tertiary);cursor:pointer;
  display:none;align-items:center;justify-content:center;
  transition:all var(--transition);flex-shrink:0;
}
.sidebar-toggle:hover{color:var(--fg);background:var(--bg-hover)}
.sidebar-toggle svg{width:18px;height:18px;stroke-width:2}
@media(min-width:769px){.sidebar-toggle{display:flex}}
.sidebar-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;letter-spacing:-0.02em;white-space:nowrap;overflow:hidden}
.sidebar-brand img{width:22px;height:22px;border-radius:6px;flex-shrink:0}
.sidebar.collapsed .sidebar-brand span{display:none}
.sidebar-nav{display:flex;flex-direction:column;gap:2px;padding:8px}
.sidebar-nav-item{
  display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--radius-sm);
  cursor:pointer;color:var(--fg-tertiary);font-size:14px;font-weight:500;
  transition:all var(--transition);border:none;background:transparent;font-family:var(--font);width:100%;text-align:left;
}
.sidebar-nav-item:hover{background:var(--bg-hover);color:var(--fg)}
.sidebar-nav-item svg{width:18px;height:18px;flex-shrink:0;stroke-width:2}
.sidebar.collapsed .sidebar-nav-item span{display:none}
.sidebar.collapsed .sidebar-nav-item{justify-content:center;padding:10px}
.sidebar-section-label{font-size:11px;font-weight:600;color:var(--fg-quaternary);text-transform:uppercase;letter-spacing:0.06em;padding:12px 12px 4px}
.sidebar.collapsed .sidebar-section-label{display:none}
.session-list{flex:1;overflow-y:auto;padding:4px 8px}
.sidebar.collapsed .session-list{display:none}
.session-item{
  padding:10px 12px;border-radius:var(--radius-sm);cursor:pointer;
  display:flex;align-items:center;gap:8px;font-size:14px;
  color:var(--fg-secondary);transition:all var(--transition);margin:1px 0;
}
.session-item:hover{background:var(--bg-hover);color:var(--fg)}
.session-item.active{background:var(--bg-hover);color:var(--fg);font-weight:500}
.session-item .s-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-item .s-channel-badge{font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:var(--border);color:var(--fg-tertiary);flex-shrink:0;letter-spacing:.3px}
.session-item .s-del{
  opacity:0;background:none;border:none;color:var(--fg-tertiary);cursor:pointer;
  padding:2px;font-size:12px;line-height:1;border-radius:4px;transition:opacity var(--transition);
  display:flex;align-items:center;justify-content:center;
}
.session-item:hover .s-del{opacity:0.6}
.session-item .s-del:hover{opacity:1;color:var(--fg)}
.sidebar-footer{padding:12px 16px;border-top:1px solid var(--border);margin-top:auto}
.sidebar-user{
  display:flex;align-items:center;gap:10px;padding:4px;cursor:pointer;
  border-radius:var(--radius-sm);transition:all var(--transition);
}
.sidebar-user:hover{background:var(--bg-hover)}
.sidebar-avatar{
  width:32px;height:32px;border-radius:50%;background:var(--bg-hover);
  display:flex;align-items:center;justify-content:center;font-size:13px;
  font-weight:600;color:var(--fg);flex-shrink:0;border:1px solid var(--border);
  overflow:hidden;
}
.sidebar-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.sidebar-username{font-size:14px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-useremail{font-size:12px;color:var(--fg-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar.collapsed .sidebar-footer{padding:12px 8px;display:flex;justify-content:center}
.sidebar.collapsed .sidebar-user-info{display:none}
.sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.3);backdrop-filter:blur(4px);z-index:25;display:none}
.sidebar-overlay.show{display:block}
@media(min-width:769px){.sidebar-overlay{display:none!important}}

/* ─── Main Content ─── */
.main-content{flex:1;display:flex;flex-direction:column;min-width:0;height:100%;position:relative}

/* ─── Header ─── */
#header{
  padding:12px 20px;display:flex;align-items:center;justify-content:space-between;
  flex-shrink:0;position:relative;z-index:10;
}
.header-left{display:flex;align-items:center;gap:8px}
.menu-btn{
  background:transparent;border:none;cursor:pointer;color:var(--fg-secondary);
  padding:8px;margin:-8px;display:flex;align-items:center;justify-content:center;
  border-radius:var(--radius-sm);transition:all var(--transition);
}
.menu-btn:hover{color:var(--fg);background:var(--bg-hover)}
.menu-btn svg{width:20px;height:20px}
@media(min-width:769px){.menu-btn{display:none!important}}
.header-right{display:flex;align-items:center;gap:8px}
#status{
  font-size:12px;font-weight:500;color:#16a34a;
  display:flex;align-items:center;gap:5px;
  padding:4px 10px;border-radius:20px;background:rgba(22,163,74,0.06);
}
#status::before{content:"";width:6px;height:6px;border-radius:50%;background:#16a34a}
#status.disconnected{color:#dc2626;background:rgba(220,38,38,0.06)}
#status.disconnected::before{background:#dc2626}
.collapse-stats{
  font-size:11px;font-weight:500;color:var(--fg-tertiary);
  display:flex;align-items:center;gap:4px;
  padding:3px 8px;border-radius:12px;background:var(--bg-hover);
}
.collapse-stats.has-errors{color:#d97706;background:rgba(217,119,6,0.08)}

/* ─── Welcome State ─── */
#welcome{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:0 24px 120px;gap:12px;opacity:1;transition:opacity .3s ease;
}
#welcome.hidden{display:none}
.welcome-greeting{
  font-size:32px;font-weight:700;letter-spacing:-0.04em;
  color:var(--fg);line-height:1.2;text-align:center;
}
.welcome-sub{
  font-size:16px;color:var(--fg-tertiary);font-weight:400;
  text-align:center;margin-bottom:8px;
}
.welcome-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:560px;margin-top:8px}
.welcome-chip{
  padding:10px 18px;border-radius:20px;font-size:14px;font-weight:500;
  background:var(--bg-surface);border:1px solid var(--border);
  color:var(--fg-secondary);cursor:pointer;font-family:var(--font);
  transition:all var(--transition);white-space:nowrap;
}
.welcome-chip:hover{background:var(--bg-hover);color:var(--fg);border-color:var(--input-border)}

/* ─── Messages ─── */
#messages{
  flex:1;overflow-y:auto;padding:24px 16px 24px;
  display:none;flex-direction:column;gap:4px;
  scroll-behavior:smooth;
}
#messages.active{display:flex}
.msg-group{max-width:720px;width:100%;margin:0 auto;padding:16px 0}
.msg-group.user{padding:12px 0}
.msg-group.assistant{padding:16px 0}
.msg-label{
  font-size:13px;font-weight:600;color:var(--fg-tertiary);
  margin-bottom:6px;letter-spacing:-0.01em;
}
.msg{
  font-size:15px;line-height:1.75;word-wrap:break-word;font-weight:400;
  letter-spacing:-0.01em;color:var(--fg);
}
.msg.user{
  background:var(--msg-user-bg);padding:12px 18px;border-radius:var(--radius-md);
  white-space:pre-wrap;color:var(--fg);
}
.msg.assistant{color:var(--fg)}
.msg.error{
  background:#fef2f2;color:#991b1b;display:flex;align-items:center;gap:8px;
  font-size:14px;border-radius:var(--radius-md);max-width:fit-content;margin:4px auto;
  padding:10px 16px;border:1px solid #fecaca;
}
@keyframes fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.msg-group{animation:fade-in .3s ease-out}

/* ─── Markdown Content ─── */
.msg h1{font-size:1.6em;font-weight:700;margin:20px 0 10px;line-height:1.3;letter-spacing:-0.03em}
.msg h2{font-size:1.3em;font-weight:650;margin:18px 0 8px;line-height:1.35;letter-spacing:-0.02em}
.msg h3{font-size:1.1em;font-weight:600;margin:14px 0 6px;line-height:1.4}
.msg h4{font-size:1em;font-weight:600;margin:12px 0 4px;line-height:1.4}
.msg h1:first-child,.msg h2:first-child,.msg h3:first-child,.msg h4:first-child{margin-top:0}
.msg code{
  font-family:var(--font-mono);font-size:0.85em;
  background:var(--code-bg);padding:2px 7px;border-radius:6px;
  border:1px solid var(--border);color:#1e293b;
}
.msg pre{
  background:var(--code-bg);padding:16px;border-radius:var(--radius-md);
  border:1px solid var(--border);overflow-x:auto;margin:12px 0;max-width:100%;
}
.msg pre code{background:none;padding:0;border:none;font-size:13.5px;line-height:1.65;color:var(--fg)}
.msg pre code.hljs{background:var(--code-bg)}
.msg table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
.msg thead{background:var(--bg-surface)}
.msg th,.msg td{padding:8px 12px;border:1px solid var(--border);text-align:left}
.msg th{font-weight:600;color:var(--fg-secondary)}
.msg blockquote{border-left:3px solid var(--fg-quaternary);padding:4px 16px;margin:8px 0;color:var(--fg-secondary)}
.msg ul,.msg ol{padding-left:24px;margin:8px 0}
.msg li{margin:4px 0;line-height:1.65}
.msg p{margin:0 0 8px 0}
.msg p:last-child{margin-bottom:0}
.msg hr{border:none;border-top:1px solid var(--border);margin:16px 0}
.msg a{color:#2563eb;text-decoration:none;font-weight:500;transition:color var(--transition)}
.msg a:hover{color:#1d4ed8;text-decoration:underline}
.msg img{max-width:100%;border-radius:var(--radius-md);margin:8px 0;border:1px solid var(--border)}
.code-block{position:relative;margin:12px 0}
.code-block pre{margin:0}
.code-lang{position:absolute;top:8px;left:14px;font-size:11px;color:var(--fg-quaternary);font-weight:600;text-transform:uppercase;font-family:var(--font);letter-spacing:0.04em}
.code-block:has(.code-lang) pre{padding-top:32px}
.code-copy{
  position:absolute;top:8px;right:10px;opacity:0;
  background:var(--bg-hover);color:var(--fg-secondary);border:1px solid var(--border);
  padding:3px 10px;border-radius:6px;font-size:12px;cursor:pointer;
  transition:opacity var(--transition);font-family:var(--font);
}
.code-block:hover .code-copy{opacity:1}
.code-copy:hover{background:var(--input-border);color:var(--fg)}

/* ─── Thinking indicator ─── */
.thinking-indicator{
  max-width:720px;width:100%;margin:8px auto;padding:0 0 0 4px;
  display:flex;align-items:center;gap:10px;
  color:var(--fg-tertiary);font-size:14px;font-weight:500;
  animation:fade-in .3s ease-out;
}
.thinking-dots{display:flex;gap:4px}
.thinking-dots span{
  width:6px;height:6px;border-radius:50%;background:var(--fg-tertiary);
  animation:thinking-bounce 1.4s ease-in-out infinite;
}
.thinking-dots span:nth-child(2){animation-delay:0.16s}
.thinking-dots span:nth-child(3){animation-delay:0.32s}
@keyframes thinking-bounce{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}
.thinking-content{
  flex-basis:100%;
  margin:4px 0 0 2px;padding:4px 16px;
  border-left:2px solid var(--border);
  color:var(--fg-secondary);
  font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;
  max-height:200px;overflow-y:auto;
}
.thinking-indicator{flex-wrap:wrap}

.thinking-done{max-width:720px;width:100%;margin:8px auto 4px;padding:0}
.thinking-toggle{
  display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  color:var(--fg-tertiary);font-size:13px;font-weight:500;
  padding:6px 0;user-select:none;
}
.thinking-toggle:hover{color:var(--fg-secondary)}
.thinking-chevron{transition:transform .2s ease;flex-shrink:0}
.thinking-done.expanded .thinking-chevron{transform:rotate(180deg)}
.thinking-detail{
  max-height:0;overflow:hidden;
  border-left:2px solid var(--border);margin:0 0 0 2px;padding:0 16px;
  font-size:14px;line-height:1.6;color:var(--fg-secondary);
  transition:max-height .3s ease,padding .3s ease,margin-top .3s ease;
}
.thinking-detail p{margin:0 0 8px}
.thinking-detail p:last-child{margin-bottom:0}
.thinking-detail ul,.thinking-detail ol{margin:0 0 8px;padding-left:20px}
.thinking-done.expanded .thinking-detail{
  max-height:400px;overflow-y:auto;padding:4px 16px;margin-top:4px;
}

/* ─── Streaming cursor ─── */
.msg.streaming .cursor{
  display:inline-block;width:2px;height:1.1em;background:var(--fg-tertiary);
  animation:blink .7s step-end infinite;vertical-align:text-bottom;margin-left:1px;
}
@keyframes blink{50%{opacity:0}}

/* ─── Agent Panel ─── */
#agent-panel{
  max-width:720px;width:100%;margin:0 auto;padding:0 16px 4px;
}
#agent-panel-header{
  display:flex;align-items:center;gap:8px;
  padding:6px 10px;border-radius:var(--radius-md);
  background:var(--bg-elevated);border:1px solid var(--border);
  font-size:12px;cursor:pointer;user-select:none;
}
#agent-panel-toggle{font-size:10px;color:var(--muted);transition:transform 0.15s}
#agent-panel-title{font-weight:600;color:var(--text)}
#agent-panel-count{color:var(--muted);flex:1}
#agent-panel-close{
  background:none;border:none;cursor:pointer;color:var(--muted);
  font-size:16px;padding:0 2px;line-height:1;
}
#agent-panel-close:hover{color:var(--text)}
#agent-panel-body{
  display:flex;flex-direction:column;gap:2px;
  padding:4px 0 0;
}
#agent-panel.collapsed #agent-panel-body{display:none}
#agent-panel.collapsed #agent-panel-toggle{transform:rotate(-90deg)}
.agent-row{
  display:flex;align-items:center;gap:8px;
  padding:4px 10px;font-size:12px;
  border-left:2px solid var(--border);
}
.agent-dot{
  width:8px;height:8px;border-radius:50%;flex-shrink:0;
}
.agent-name{font-weight:500;color:var(--text)}
.agent-status{color:var(--muted);flex:1}
.agent-dot.running{animation:blink 1s infinite}

/* ─── Input Area ─── */
#input-wrapper{
  max-width:720px;width:100%;margin:0 auto;padding:0 16px 20px;
  position:relative;z-index:5;
}
.slash-menu{
  position:absolute;bottom:100%;left:16px;right:16px;
  max-height:260px;overflow-y:auto;
  background:var(--input-bg);border:1px solid var(--border);
  border-radius:var(--radius-lg);box-shadow:0 4px 16px rgba(0,0,0,0.15);
  padding:4px 0;margin-bottom:4px;
}
.slash-menu.hidden{display:none}
.slash-menu-item{
  display:flex;align-items:center;gap:8px;
  padding:8px 12px;cursor:pointer;
  transition:background var(--transition);
}
.slash-menu-item:hover,.slash-menu-item.active{background:var(--bg-hover)}
.slash-menu-item-name{font-weight:500;color:var(--fg);font-size:14px;white-space:nowrap;flex-shrink:0}
.slash-menu-item-desc{color:var(--fg-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#input-area{
  background:var(--input-bg);border:1px solid var(--border);
  border-radius:var(--radius-xl);padding:8px 12px;
  display:flex;flex-direction:column;gap:6px;
  transition:border-color var(--transition),box-shadow var(--transition);
}
#input-area:focus-within{border-color:var(--input-focus);box-shadow:0 0 0 1px var(--input-focus)}
#previews{display:flex;gap:8px;flex-wrap:wrap;padding:4px 6px 0}
#previews:empty{display:none}
.preview-item{
  position:relative;border-radius:var(--radius-sm);overflow:hidden;
  background:var(--bg-hover);border:1px solid var(--border);
  display:flex;align-items:center;
}
.preview-item img{display:block;height:56px;width:56px;object-fit:cover}
.preview-item .file-info{padding:6px 10px;font-size:12px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--fg-secondary)}
.preview-item .remove{
  position:absolute;top:3px;right:3px;width:20px;height:20px;
  background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;
  font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(4px);transition:background var(--transition);
}
.preview-item .remove:hover{background:rgba(0,0,0,0.9)}
.input-row{display:flex;gap:6px;align-items:flex-end}
#attach{
  background:transparent;border:none;border-radius:50%;width:36px;height:36px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  color:var(--fg-tertiary);flex-shrink:0;transition:all var(--transition);
}
#attach:hover{color:var(--fg);background:var(--bg-hover)}
#attach svg{width:18px;height:18px;stroke-width:2}
#input{
  flex:1;resize:none;border:none;background:transparent;color:var(--fg);
  max-height:200px;min-height:40px;line-height:1.5;outline:none;
  font-family:var(--font);font-size:15px;padding:8px 0;
  letter-spacing:-0.01em;
}
#input::placeholder{color:var(--fg-quaternary)}
#send{
  background:var(--accent);color:var(--accent-text);border:none;
  border-radius:50%;width:36px;height:36px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  transition:all var(--transition);flex-shrink:0;
}
#send:hover:not(:disabled){background:var(--accent-hover);transform:scale(1.04)}
#send:active:not(:disabled){transform:scale(0.96)}
#send:disabled{opacity:0.25;cursor:not-allowed}
#send svg{width:16px;height:16px;stroke-width:2.5;margin-left:1px}
.input-hint{
  text-align:center;padding:8px 0 0;font-size:12px;color:var(--fg-quaternary);
}

/* ─── Tool display ─── */
.tool-container{display:flex;flex-direction:column;gap:2px;max-width:720px;width:100%;margin:0 auto;padding:0 0 0 4px}
.tool-item{
  display:flex;align-items:center;gap:8px;padding:4px 10px;
  border-left:2px solid var(--border);font-size:13px;
  font-family:var(--font-mono);animation:fade-in .2s ease-out;
  transition:opacity .4s ease;
}
.tool-item.terminal{border-left-color:#16a34a}
.tool-item.file{border-left-color:#2563eb}
.tool-item.search{border-left-color:#9333ea}
.tool-icon{flex-shrink:0;width:14px;height:14px;color:var(--fg-tertiary)}
.tool-label{font-size:12px;color:var(--fg-tertiary);flex-shrink:0;font-family:var(--font);font-weight:500}
.tool-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg);opacity:0.7}
.tool-value.terminal-cmd{color:#16a34a}
.tool-secondary{font-size:11px;color:var(--fg-tertiary);font-family:var(--font);flex-shrink:0}
.tool-item.done{opacity:0.3}
.tool-item.error{opacity:0.8}
.tool-item.error .tool-value{color:#dc2626}
.tool-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--fg-tertiary);animation:pulse 1.4s ease-in-out infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}
.agent-container{display:flex;flex-direction:column;gap:2px;border-left:2px solid var(--fg-quaternary);border-radius:4px;padding:4px 0 4px 12px;margin:2px 0}
.agent-header{display:flex;align-items:center;gap:8px;padding:4px 10px;font-size:13px;cursor:pointer;user-select:none;font-family:var(--font);font-weight:500;color:var(--fg-tertiary)}
.agent-header:hover{color:var(--fg)}
.agent-toggle{font-size:10px;transition:transform .2s;display:inline-block}
.agent-toggle.collapsed{transform:rotate(-90deg)}
.agent-children{display:flex;flex-direction:column;gap:2px}
.agent-children.collapsed{display:none}
.agent-container.done{opacity:0.3}

/* ─── File badge / card ─── */
.file-badge{
  display:inline-flex;align-items:center;gap:6px;
  background:var(--bg-surface);border:1px solid var(--border);
  padding:5px 12px;border-radius:20px;font-size:13px;font-weight:500;margin:3px;
  color:var(--fg-secondary);
}
.file-card{
  display:flex;align-items:center;gap:12px;padding:12px 16px;
  border:1px solid var(--border);border-radius:var(--radius-md);
  max-width:360px;margin:8px 0;background:var(--bg-surface);
  transition:background var(--transition);
}
.file-card:hover{background:var(--bg-hover)}
.file-card-icon{
  flex-shrink:0;width:36px;height:36px;border-radius:var(--radius-sm);
  background:var(--fg);color:var(--bg);
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:700;letter-spacing:0.02em;
}
.file-card-info{flex:1;min-width:0}
.file-card-name{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
.file-card-hint{font-size:12px;color:var(--fg-tertiary);margin-top:2px}
.file-card-dl{
  flex-shrink:0;padding:6px 14px;border-radius:var(--radius-sm);
  background:var(--fg);color:var(--bg);font-size:13px;font-weight:600;
  text-decoration:none;cursor:pointer;border:none;transition:background var(--transition);
}
.file-card-dl:hover{background:var(--accent-hover)}

/* ─── System commands ─── */
.system-cmd{max-width:720px;width:100%;margin:4px auto}
.system-cmd span{
  display:inline-block;background:var(--bg-surface);color:var(--fg-tertiary);
  font-size:13px;font-family:var(--font-mono);border:1px solid var(--border);
  border-radius:20px;padding:5px 14px;
}

/* ─── System notices (api_retry, compact, etc.) ─── */
.system-notice{
  max-width:720px;width:100%;margin:4px auto;
  text-align:center;font-size:12px;color:var(--fg-quaternary);
  font-family:var(--font-mono);padding:4px 12px;
  background:var(--bg-surface);border-radius:12px;
  animation:fadeNotice 8s ease-out forwards;
}
@keyframes fadeNotice{0%,80%{opacity:1}100%{opacity:0}}
/* ─── Tool progress output ─── */
.tool-progress{
  font-size:11px;font-family:var(--font-mono);color:var(--fg-quaternary);
  white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden;
  margin-top:4px;padding:4px 8px;background:var(--bg-surface);border-radius:4px;
  line-height:1.4;
}

/* ─── Permission approval dialog ─── */
.permission-card{
  background:var(--bg-elevated);border:1px solid rgba(234,179,8,0.3);
  border-radius:var(--radius-md);padding:12px 16px;margin:4px 0;
  box-shadow:0 1px 3px rgba(0,0,0,0.06);
}
.permission-card.permission-resolved{opacity:0.5}
.permission-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--fg)}
.permission-header svg{color:#eab308;flex-shrink:0}
.permission-title{font-size:13px;font-weight:600;color:var(--fg)}
.permission-message{font-size:12px;color:var(--fg-secondary);margin-bottom:10px;line-height:1.5;word-break:break-word}
.permission-input-details{margin-bottom:10px}
.permission-input-details summary{font-size:11px;color:var(--fg-tertiary);cursor:pointer;user-select:none}
.permission-input-preview{
  font-size:11px;font-family:var(--font-mono);color:var(--fg-tertiary);
  background:var(--bg-surface);border-radius:4px;padding:8px;margin-top:4px;
  max-height:120px;overflow:auto;white-space:pre-wrap;word-break:break-all;line-height:1.4;
}
.permission-suggestions{margin-bottom:10px;display:flex;flex-direction:column;gap:4px}
.permission-suggestion{font-size:11px;color:var(--fg-secondary);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.permission-suggestion input[type="checkbox"]{margin:0;accent-color:#16a34a;cursor:pointer}
.permission-actions{display:flex;gap:8px;margin-bottom:6px}
.permission-btn{
  padding:5px 16px;border-radius:var(--radius-sm);font-size:12px;font-weight:500;
  cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s;
}
.permission-btn-allow{background:#16a34a;color:#fff;border-color:#16a34a}
.permission-btn-allow:hover{background:#15803d}
.permission-btn-deny{background:var(--bg-surface);color:var(--fg);border-color:var(--border)}
.permission-btn-deny:hover{background:var(--bg-hover);border-color:#dc2626;color:#dc2626}
.permission-timer{font-size:10px;color:var(--fg-quaternary)}
.permission-result{font-size:12px;font-weight:500;margin-top:4px}
.permission-allowed{color:#16a34a}
.permission-denied{color:#dc2626}

/* ─── Config notification ─── */
.config-banner{
  position:fixed;top:70px;left:50%;transform:translateX(-50%);
  max-width:480px;width:calc(100% - 32px);background:var(--bg-elevated);
  border:1px solid rgba(250,204,21,0.2);border-radius:var(--radius-md);
  padding:12px 16px;box-shadow:var(--shadow-md);z-index:20;
  animation:fade-in .3s ease-out;display:flex;align-items:center;gap:12px;font-size:14px;
}
.config-banner button{background:none;border:none;font-size:18px;cursor:pointer;color:var(--fg-tertiary);padding:2px 6px;line-height:1}

/* ─── Drop overlay ─── */
.drop-overlay{
  position:fixed;inset:0;background:rgba(255,255,255,0.85);backdrop-filter:blur(8px);
  border:2px dashed var(--fg-quaternary);z-index:100;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:16px;color:var(--fg);font-weight:600;font-size:18px;pointer-events:none;
  border-radius:var(--radius-lg);margin:16px;
}
.drop-icon{width:56px;height:56px;color:var(--fg-tertiary)}

/* ─── User Menu ─── */
.user-menu{
  position:absolute;bottom:calc(100% + 8px);left:8px;right:8px;
  background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;
  box-shadow:var(--shadow-lg);z-index:50;
  display:none;flex-direction:column;padding:4px;
  animation:fade-in .15s ease-out;
}
.user-menu.open{display:flex}
.user-menu-email{padding:10px 12px 6px;font-size:13px;color:var(--fg-tertiary);border-bottom:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user-menu-item{
  display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
  cursor:pointer;color:var(--fg);font-size:14px;font-weight:400;
  border:none;background:transparent;font-family:var(--font);width:100%;text-align:left;
  transition:background var(--transition);position:relative;
}
.user-menu-item:hover,.user-menu-item.selected{background:var(--bg-hover)}
.user-menu-item svg{width:18px;height:18px;flex-shrink:0;color:var(--fg-tertiary);stroke-width:1.5}
.user-menu-item .menu-arrow{margin-left:auto;color:var(--fg-quaternary);width:14px;height:14px}
.user-menu-sep{height:1px;background:var(--border);margin:4px 8px}
.user-menu-sub{
  position:fixed;min-width:200px;
  background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;
  box-shadow:var(--shadow-lg);padding:4px;display:none;flex-direction:column;
  animation:fade-in .1s ease-out;z-index:51;
}
.user-menu-sub.open{display:flex}
.user-menu-sub .user-menu-item{font-size:14px;padding:8px 12px}
.user-menu-item .menu-check{margin-left:auto;color:var(--fg-tertiary);width:16px;height:16px;display:none}
.user-menu-item.active .menu-check{display:block}

/* ─── Admin View ─── */
#admin-view{
  position:absolute;inset:0;background:var(--bg);z-index:5;
  overflow:hidden;display:none;flex-direction:column;
}
#admin-view[style*="display:flex"],#admin-view[style*="display: flex"]{display:flex!important}
.admin-inner{display:flex;flex-direction:column;height:100%;padding:16px 24px 0}
.admin-inner .settings-back{flex-shrink:0;margin-bottom:8px}
#admin-iframe{flex:1;min-height:0}

/* ─── Settings View ─── */
#settings-view{
  position:absolute;inset:0;background:var(--bg);z-index:5;
  overflow-y:auto;padding:48px 24px;
}
.settings-inner{max-width:960px;margin:0 auto;display:flex;gap:32px}
.settings-sidebar{width:200px;min-width:200px;position:sticky;top:0;align-self:flex-start}
.settings-sidebar-title{font-size:24px;font-weight:600;margin-bottom:20px}
.settings-sidebar-nav{display:flex;flex-direction:column;gap:2px}
.settings-nav-item{
  display:block;width:100%;padding:8px 12px;border-radius:8px;font-size:14px;font-weight:500;
  color:var(--fg-tertiary);cursor:pointer;transition:all .15s;text-align:left;
  border:none;background:none;font-family:var(--font);
}
.settings-nav-item:hover{background:var(--bg-hover);color:var(--fg)}
.settings-nav-item.active{background:var(--bg-hover);color:var(--fg);font-weight:600}
.settings-content{flex:1;min-width:0}
.settings-tab-panel{display:none}
.settings-tab-panel.active{display:block}
@media(max-width:640px){
  .settings-inner{flex-direction:column;gap:16px}
  .settings-sidebar{width:100%;min-width:0;position:static;display:flex;align-items:center;gap:12px}
  .settings-sidebar-title{margin-bottom:0;font-size:20px}
  .settings-sidebar-nav{flex-direction:row;flex-wrap:wrap}
}
.settings-back{
  display:inline-flex;align-items:center;gap:6px;padding:4px 0;margin-bottom:24px;
  font-size:14px;color:var(--fg-tertiary);background:none;border:none;
  cursor:pointer;font-family:var(--font);transition:color .15s;
}
.settings-back:hover{color:var(--fg)}
.settings-back svg{width:16px;height:16px}
.settings-title{font-size:24px;font-weight:600;margin-bottom:32px}
.settings-section{margin-bottom:36px}
.settings-section-title{font-size:18px;font-weight:600;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.settings-profile-header{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.settings-avatar{
  width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:22px;font-weight:600;color:var(--bg);background:var(--accent);flex-shrink:0;
  position:relative;cursor:pointer;overflow:hidden;
}
.settings-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.settings-avatar-overlay{
  position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,0.45);
  display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;
}
.settings-avatar:hover .settings-avatar-overlay{opacity:1}
.settings-avatar-overlay svg{width:20px;height:20px;color:#fff}
.settings-profile-name{font-size:16px;font-weight:600}
.settings-profile-email{font-size:13px;color:var(--fg-tertiary);margin-top:2px}
.settings-field{margin-bottom:20px}
.settings-field-label{display:block;font-size:13px;font-weight:500;color:var(--fg-secondary);margin-bottom:6px}
.settings-field-input{
  width:100%;max-width:320px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;
  font-size:14px;font-family:var(--font);background:var(--bg);color:var(--fg);outline:none;
  transition:border-color .15s;
}
.settings-field-input:focus{border-color:var(--accent)}
.settings-btn-save{
  padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:500;
  font-family:var(--font);background:var(--accent);color:var(--bg);cursor:pointer;transition:opacity .15s;
}
.settings-btn-save:hover{opacity:0.85}
.settings-btn-save:disabled{opacity:0.5;cursor:not-allowed}
.settings-save-status{display:inline-block;margin-left:12px;font-size:13px;color:var(--fg-tertiary)}
.settings-theme-options{display:flex;gap:16px;flex-wrap:wrap}
.settings-theme-card{
  cursor:pointer;border:2px solid var(--border);border-radius:12px;padding:4px;
  transition:border-color .15s;width:120px;
}
.settings-theme-card:hover{border-color:var(--fg-tertiary)}
.settings-theme-card.active{border-color:var(--accent)}
.settings-theme-preview{width:100%;aspect-ratio:4/3;border-radius:8px;overflow:hidden;position:relative}
.settings-theme-preview-light{background:#f8fafc;border:1px solid #e2e8f0}
.settings-theme-preview-light::after{content:'';position:absolute;bottom:8px;left:8px;right:8px;height:12px;background:#020617;border-radius:4px}
.settings-theme-preview-dark{background:#1e293b;border:1px solid #334155}
.settings-theme-preview-dark::after{content:'';position:absolute;bottom:8px;left:8px;right:8px;height:12px;background:#f8fafc;border-radius:4px}
.settings-theme-preview-auto{background:linear-gradient(135deg,#f8fafc 50%,#1e293b 50%);border:1px solid #e2e8f0}
.settings-theme-preview-auto::after{content:'';position:absolute;bottom:8px;left:8px;right:8px;height:12px;background:linear-gradient(90deg,#020617 50%,#f8fafc 50%);border-radius:4px}
.settings-theme-label{text-align:center;font-size:13px;color:var(--fg-secondary);margin-top:8px;padding-bottom:4px}
/* Permission mode cards */
.settings-permission-options{display:flex;flex-direction:column;gap:8px}
.settings-perm-card{
  display:flex;align-items:center;gap:12px;padding:12px 16px;
  border:2px solid var(--border);border-radius:12px;cursor:pointer;
  transition:border-color .15s,background .15s;
}
.settings-perm-card:hover{border-color:var(--fg-tertiary);background:var(--bg-hover)}
.settings-perm-card.active{border-color:var(--accent);background:rgba(99,102,241,0.05)}
.settings-perm-icon{flex-shrink:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-surface);color:var(--fg-secondary)}
.settings-perm-card.active .settings-perm-icon{color:var(--accent)}
.settings-perm-info{flex:1;min-width:0}
.settings-perm-label{font-size:14px;font-weight:600;color:var(--fg);margin-bottom:2px}
.settings-perm-desc{font-size:12px;color:var(--fg-tertiary);line-height:1.4}
.settings-lang-options{display:flex;gap:8px}
.settings-lang-option{
  padding:8px 16px;border:1px solid var(--border);border-radius:8px;font-size:14px;
  font-family:var(--font);cursor:pointer;background:transparent;color:var(--fg);transition:all .15s;
}
.settings-lang-option:hover{border-color:var(--fg-tertiary)}
.settings-lang-option.active{border-color:var(--accent);background:var(--accent);color:var(--bg)}

/* ─── Settings: MCP & Cron ─── */
.settings-section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.settings-section-header-title{font-size:18px;font-weight:600}
.s-btn{padding:6px 12px;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);transition:all .15s}
.s-btn-primary{background:var(--accent);color:var(--bg)}
.s-btn-primary:hover{opacity:0.85}
.s-btn-ghost{background:transparent;color:var(--fg-tertiary);border:1px solid var(--border)}
.s-btn-ghost:hover{color:var(--fg);background:var(--bg-hover)}
.s-btn-danger{background:transparent;color:#dc2626;border:1px solid #dc2626}
.s-btn-danger:hover{background:#dc2626;color:#fff}
.s-actions{display:flex;gap:6px;flex-wrap:wrap}
.s-form{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px}
.s-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.s-form-full{grid-column:1/-1}
.s-form label{display:block;font-size:13px;font-weight:500;margin-bottom:4px;color:var(--fg-secondary)}
.s-form-input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--fg);outline:none}
.s-form-input:focus{border-color:var(--accent)}
.s-form-select{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--fg);outline:none}
.s-form-textarea{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--fg);outline:none;resize:vertical}
.s-table{width:100%;border-collapse:collapse}
.s-table th{text-align:left;padding:10px 12px;font-size:12px;font-weight:500;color:var(--fg-tertiary);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
.s-table td{padding:12px;border-bottom:1px solid var(--border);font-size:14px;vertical-align:middle}
.s-code{font-family:var(--font-mono);font-size:13px;background:var(--bg-surface);padding:3px 8px;border-radius:4px}
.s-muted{color:var(--fg-tertiary);font-size:13px}
.s-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}
.s-badge-green{background:#dcfce7;color:#166534}
.s-badge-gray{background:var(--bg-surface);color:var(--fg-tertiary);border:1px solid var(--border)}
.s-badge-red{background:#fee2e2;color:#991b1b}
.s-empty{text-align:center;padding:32px 24px;color:var(--fg-tertiary);font-size:14px}
.s-scheduler-bar{display:flex;align-items:center;gap:16px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;margin-bottom:16px;font-size:13px;color:var(--fg-tertiary);flex-wrap:wrap}
.s-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.s-dot-green{background:#16a34a}
.s-dot-red{background:#dc2626}
.s-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:10px 20px;border-radius:8px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:200}
.s-toast.show{opacity:1}
[data-theme="dark"] .s-badge-green{background:#14532d;color:#86efac}
[data-theme="dark"] .s-badge-red{background:#450a0a;color:#fca5a5}
@media(prefers-color-scheme:dark){
  :root:not([data-theme="light"]) .s-badge-green{background:#14532d;color:#86efac}
  :root:not([data-theme="light"]) .s-badge-red{background:#450a0a;color:#fca5a5}
}
/* Skills tab */
.settings-section-desc{font-size:14px;color:var(--fg-tertiary);margin-bottom:16px}
.sk-tabs{display:flex;gap:4px;margin-bottom:12px}
.sk-tab{padding:6px 14px;border:1px solid var(--border);border-radius:18px;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);background:transparent;color:var(--fg-tertiary);transition:all .15s}
.sk-tab:hover{color:var(--fg);background:var(--bg-hover)}
.sk-tab.active{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.sk-search{margin-bottom:16px}
.sk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.sk-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s}
.sk-card:hover{border-color:var(--accent)}
.sk-card-head{display:flex;align-items:center;justify-content:space-between}
.sk-card-info{display:flex;align-items:center;gap:8px;min-width:0}
.sk-card-emoji{font-size:24px;flex-shrink:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--bg-hover);border-radius:8px}
.sk-card-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sk-card-desc{font-size:13px;color:var(--fg-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sk-card-badges{display:flex;gap:4px;flex-wrap:wrap;margin-top:auto}
.sk-toggle{position:relative;width:36px;height:20px;flex-shrink:0}
.sk-toggle input{opacity:0;width:0;height:0}
.sk-toggle .sk-slider{position:absolute;cursor:pointer;inset:0;background:var(--border);border-radius:10px;transition:.2s}
.sk-toggle .sk-slider:before{content:"";position:absolute;height:16px;width:16px;left:2px;bottom:2px;background:#fff;border-radius:50%;transition:.2s}
.sk-toggle input:checked+.sk-slider{background:var(--accent)}
.sk-toggle input:checked+.sk-slider:before{transform:translateX(16px)}
.sk-empty{text-align:center;padding:48px 24px;color:var(--fg-tertiary);font-size:14px}
.sk-card-actions{display:flex;gap:6px;margin-top:auto;align-items:center}
.sk-install-market-btn{padding:5px 14px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font);border:1px solid var(--accent);background:var(--accent);color:var(--bg);transition:all .15s}
.sk-install-market-btn:hover{opacity:0.85}
.sk-install-market-btn:disabled{opacity:0.5;cursor:default}
.sk-install-market-btn.installed{background:transparent;color:var(--fg-tertiary);border-color:var(--border);cursor:default}
.sk-install-market-btn.installed:hover{opacity:1}
.sk-uninstall-btn{padding:5px 10px;border-radius:8px;font-size:12px;cursor:pointer;font-family:var(--font);border:1px solid var(--border);background:transparent;color:var(--fg-tertiary);transition:all .15s}
.sk-uninstall-btn:hover{color:#ef4444;border-color:#ef4444}
.sk-dropzone{border:2px dashed var(--border);border-radius:12px;padding:40px 24px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.sk-dropzone:hover{border-color:var(--fg-tertiary)}
.sk-dropzone.drag-over{border-color:var(--accent);background:var(--bg-hover)}
.sk-upload-hints{margin-top:12px;font-size:12px;color:var(--fg-tertiary);line-height:1.6}
#sk-upload-status{padding:10px 14px;border-radius:8px;font-size:13px;background:var(--bg-hover)}
@media(max-width:640px){.s-form-grid{grid-template-columns:1fr}.sk-grid{grid-template-columns:1fr}}

/* ─── Channel grid & modal ─── */
.ch-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
@media(max-width:640px){.ch-grid{grid-template-columns:1fr}}
.ch-card{background:var(--bg-surface);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:10px;transition:box-shadow .15s}
.ch-card-head{display:flex;align-items:center;justify-content:space-between}
.ch-card-desc{font-size:13px;color:var(--fg-tertiary);line-height:1.5}
.ch-card-btn{padding:6px 16px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);border:1px solid var(--border);background:var(--bg);color:var(--fg);transition:all .15s;white-space:nowrap}
.ch-card-btn:hover{background:var(--bg-hover)}
.ch-card-btn.connected{background:var(--bg);color:var(--fg);border-color:var(--border);position:relative;padding-left:22px}
.ch-card-btn.connected::before{content:"";position:absolute;left:10px;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:50%;background:#22c55e}
.ch-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:100;justify-content:center;align-items:center}
.ch-modal-overlay.show{display:flex}
.ch-modal{background:var(--bg);border-radius:16px;width:90%;max-width:520px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
.ch-modal-header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border)}
.ch-modal-close{background:none;border:none;font-size:24px;color:var(--fg-tertiary);cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1}
.ch-modal-close:hover{color:var(--fg);background:var(--bg-hover)}
.ch-modal-body{padding:24px}

/* ─── Scrollbar ─── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--fg-quaternary)}
`;
}
