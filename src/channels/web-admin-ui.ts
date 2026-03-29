/**
 * Admin panel HTML template with vertical tab navigation.
 *
 * Tabs:
 *  - Settings: general, web, session, transcripts, cron global
 *  - Users: user stats → sessions → conversation history (drill-down)
 *  - Invites: invite code CRUD
 *  - Cron: task list with CRUD + scheduler status
 */

export function getAdminHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Klaus Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #ffffff; --fg: #0f172a; --border: #e2e8f0;
  --card-bg: #f8fafc; --accent: #020617; --accent-text: #ffffff;
  --accent-hover: #334155; --danger: #dc2626; --danger-hover: #b91c1c;
  --success: #16a34a; --muted: #64748b; --user-bg: #f1f5f9; --bot-bg: #ffffff;
  --bg-hover: #f1f5f9;
  --font-main: 'Plus Jakarta Sans', -apple-system, sans-serif;
  --font-mono: 'SF Mono', 'Consolas', 'Monaco', monospace;
}
[data-theme="dark"] {
  --bg: #0f172a; --fg: #f8fafc; --border: #334155;
  --card-bg: #1e293b; --accent: #f8fafc; --accent-text: #0f172a;
  --accent-hover: #e2e8f0; --danger: #ef4444; --danger-hover: #dc2626;
  --success: #22c55e; --muted: #94a3b8; --user-bg: #1e293b; --bot-bg: #0f172a;
  --bg-hover: #334155;
}
@media(prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f172a; --fg: #f8fafc; --border: #334155;
    --card-bg: #1e293b; --accent: #f8fafc; --accent-text: #0f172a;
    --accent-hover: #e2e8f0; --danger: #ef4444; --danger-hover: #dc2626;
    --success: #22c55e; --muted: #94a3b8; --user-bg: #1e293b; --bot-bg: #0f172a;
    --bg-hover: #334155;
  }
}
html, body { height: 100%; font-family: var(--font-main); background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased; }
#app { display: flex; max-width: 960px; margin: 0 auto; min-height: 100vh; padding: 48px 24px; }

/* Sidebar nav */
#sidebar {
  width: 200px; min-width: 200px; padding-right: 32px;
  position: sticky; top: 48px; align-self: flex-start;
}
.sidebar-brand {
  font-size: 24px; font-weight: 600; margin-bottom: 20px;
}
.sidebar-brand img { display: none; }
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: block; width: 100%; padding: 8px 12px; border-radius: 8px;
  font-size: 14px; font-weight: 500; color: var(--muted);
  cursor: pointer; transition: all 0.15s; text-decoration: none;
  border: none; background: none; text-align: left; font-family: var(--font-main);
}
.nav-item:hover { background: var(--bg-hover); color: var(--fg); }
.nav-item.active { background: var(--bg-hover); color: var(--fg); font-weight: 600; }
.nav-item svg { display: none; }
.sidebar-footer {
  margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--border);
}
.sidebar-footer a {
  font-size: 13px; color: var(--muted); text-decoration: none;
  display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px;
  transition: all 0.15s;
}
.sidebar-footer a:hover { color: var(--fg); background: var(--bg-hover); }

/* Content area */
#content { flex: 1; overflow-y: visible; min-width: 0; }
#content-inner { max-width: 720px; }
@media(max-width: 900px) { #app { padding: 24px 16px; } }

.nav-back {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 14px; color: var(--muted); text-decoration: none;
  margin-bottom: 24px; padding: 4px 0; transition: color 0.15s;
}
.nav-back:hover { color: var(--fg); }
.nav-back svg { width: 16px; height: 16px; }
.page-title { display: none; }

/* Section cards */
.section { margin-bottom: 32px; }
.section-header {
  font-size: 18px; font-weight: 600; margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid var(--border); color: var(--fg);
  text-transform: none; letter-spacing: 0;
}
.card {
  background: var(--card-bg); border: 1px solid var(--border);
  border-radius: 10px; overflow: hidden;
}
.card-row {
  display: flex; align-items: flex-start; gap: 16px;
  padding: 14px 20px; border-bottom: 1px solid var(--border);
}
.card-row:last-child { border-bottom: none; }
.card-label { font-size: 14px; font-weight: 500; min-width: 160px; padding-top: 7px; }
.card-hint { font-size: 12px; color: var(--muted); margin-top: 2px; font-weight: 400; }
.card-control { flex: 1; }
.card-footer { display: flex; align-items: center; gap: 10px; padding: 12px 20px; justify-content: flex-end; }

/* Form elements */
.f-select {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
  font-size: 14px; font-family: var(--font-main); background: var(--bg); color: var(--fg); outline: none;
}
.f-select:focus { border-color: var(--accent); }
.f-input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
  font-size: 14px; font-family: var(--font-main); background: var(--bg); color: var(--fg); outline: none;
}
.f-input:focus { border-color: var(--accent); }
.f-input-sm { width: 100px; }
.f-textarea {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
  font-size: 14px; font-family: var(--font-main); background: var(--bg); color: var(--fg); outline: none; resize: vertical;
}
.f-textarea:focus { border-color: var(--accent); }

/* Toggle */
.toggle-wrap { display: flex; align-items: center; gap: 10px; padding-top: 4px; }
.toggle { position: relative; width: 44px; height: 24px; cursor: pointer; }
.toggle input { display: none; }
.toggle-track { position: absolute; inset: 0; background: var(--border); border-radius: 12px; transition: background 0.2s; }
.toggle input:checked + .toggle-track { background: var(--success); }
.toggle-thumb { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: white; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.toggle input:checked ~ .toggle-thumb { transform: translateX(20px); }
.toggle-status { font-size: 13px; color: var(--muted); }

/* Buttons */
.btn { padding: 8px 16px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: var(--font-main); transition: all 0.15s; }
.btn-primary { background: var(--accent); color: var(--accent-text); }
.btn-primary:hover { background: var(--accent-hover); }
.btn-sm { padding: 6px 12px; font-size: 13px; }
.btn-copy { background: var(--card-bg); color: var(--fg); border: 1px solid var(--border); }
.btn-copy:hover { background: var(--border); }
.btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
.btn-danger:hover { background: var(--danger); color: white; }
.btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
.btn-ghost:hover { color: var(--fg); background: var(--card-bg); }
.save-status { font-size: 13px; color: var(--success); opacity: 0; transition: opacity 0.3s; }

/* Table */
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 14px; vertical-align: middle; }
tr.clickable { cursor: pointer; }
tr.clickable:hover { background: var(--card-bg); }
.code-text { font-family: var(--font-mono); font-size: 13px; background: var(--card-bg); padding: 3px 8px; border-radius: 4px; }
.stat { font-family: var(--font-mono); font-size: 13px; }
.stat-muted { color: var(--muted); font-size: 13px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.empty { text-align: center; padding: 48px 24px; color: var(--muted); font-size: 14px; }

/* Stats grid */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; cursor: pointer; transition: border-color 0.15s; }
.stat-card:hover { border-color: var(--accent); }
.stat-card .stat-label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.stat-card .stat-value { font-size: 20px; font-weight: 600; }
.stat-card .stat-detail { font-size: 12px; color: var(--muted); margin-top: 4px; }

/* Create row */
.create-row { display: flex; gap: 10px; margin-bottom: 20px; }
.create-row input { flex: 1; }

/* Breadcrumb */
.breadcrumb { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
.breadcrumb a { color: var(--muted); text-decoration: none; }
.breadcrumb a:hover { color: var(--fg); }

/* Chat history */
.chat-wrap { border: 1px solid var(--border); border-radius: 10px; max-height: 65vh; overflow-y: auto; padding: 16px; background: var(--card-bg); }
.chat-msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.chat-msg.user { background: var(--user-bg); margin-left: 40px; }
.chat-msg.assistant { background: var(--bot-bg); border: 1px solid var(--border); margin-right: 40px; }
.chat-role { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; letter-spacing: 0.5px; }

/* Badge */
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
.badge-green { background: #dcfce7; color: #166534; }
.badge-red { background: #fee2e2; color: #991b1b; }
.badge-gray { background: var(--card-bg); color: var(--muted); border: 1px solid var(--border); }
[data-theme="dark"] .badge-green, :root:not([data-theme="light"]) .badge-green { background: #14532d; color: #86efac; }
[data-theme="dark"] .badge-red, :root:not([data-theme="light"]) .badge-red { background: #450a0a; color: #fca5a5; }
@media(prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .badge-green { background: #14532d; color: #86efac; }
  :root:not([data-theme="light"]) .badge-red { background: #450a0a; color: #fca5a5; }
}

/* Scheduler status bar */
.scheduler-bar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 20px; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
.scheduler-bar .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot-green { background: var(--success); }
.dot-red { background: var(--danger); }

/* Cron task form (inline modal) */
.task-form { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
.task-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.task-form-full { grid-column: 1 / -1; }
.task-form label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: var(--muted); }

/* Tab panels & sub-views */
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.sub-view { display: none; }
.sub-view.active { display: block; }

/* Toast */
.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 10px 20px; border-radius: 8px; font-size: 14px; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
.toast.show { opacity: 1; }

/* Mobile */
@media(max-width: 640px) {
  #app { flex-direction: column; padding: 24px 16px; }
  #sidebar { width: 100%; min-width: 0; padding-right: 0; position: static; margin-bottom: 24px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .sidebar-brand { margin-bottom: 0; margin-right: auto; font-size: 20px; }
  .sidebar-nav { flex-direction: row; flex-wrap: wrap; gap: 4px; }
  .sidebar-footer { display: none; }
  .nav-item svg { width: 20px; height: 20px; }
  #content { padding: 20px 16px; }
  .task-form-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div id="app">
  <nav id="sidebar">
    <div class="sidebar-brand" data-i18n="admin_title">Admin</div>
    <div class="sidebar-nav">
      <button class="nav-item active" data-tab="settings">
        <span data-i18n="tab_settings">Settings</span>
      </button>
      <button class="nav-item" data-tab="models">
        <span data-i18n="tab_models">Models</span>
      </button>
      <button class="nav-item" data-tab="prompts">
        <span data-i18n="tab_prompts">Prompts</span>
      </button>
      <button class="nav-item" data-tab="rules">
        <span data-i18n="tab_rules">Rules</span>
      </button>
      <button class="nav-item" data-tab="users">
        <span data-i18n="tab_users">Users</span>
      </button>
      <button class="nav-item" data-tab="invites">
        <span data-i18n="tab_invites">Invites</span>
      </button>
      <button class="nav-item" data-tab="memory">
        <span data-i18n="tab_memory">Memory</span>
      </button>
    </div>
    <div class="sidebar-footer">
      <a href="/">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        <span data-i18n="back_chat">Back to Chat</span>
      </a>
    </div>
  </nav>

  <main id="content"><div id="content-inner">
    <a href="/" class="nav-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      <span data-i18n="back_klaus">Back to Klaus</span>
    </a>

    <!-- ============ Settings Tab ============ -->
    <div id="tab-settings" class="tab-panel active">
      <h1 class="page-title" data-i18n="tab_settings">Settings</h1>

      <!-- Agent -->
      <div class="section">
        <div class="section-header" data-i18n="sec_agent">Agent</div>
        <div class="card">
          <div class="card-row">
            <div class="card-label" data-i18n="lbl_max_sessions">Max Sessions</div>
            <div class="card-control"><input id="s-max-sessions" type="number" class="f-input f-input-sm" min="1"></div>
          </div>
          <div class="card-row">
            <div class="card-label">
              <div data-i18n="lbl_yolo">Auto-approve Tools</div>
            </div>
            <div class="card-control"><label><input type="checkbox" id="s-yolo"> <span data-i18n="on">On</span></label></div>
          </div>
        </div>
      </div>

      <!-- Web -->
      <div class="section">
        <div class="section-header" data-i18n="sec_web">Web Server</div>
        <div class="card">
          <div class="card-row">
            <div class="card-label">
              <div data-i18n="lbl_auth_expire">Auth Session Expiry</div>
              <div class="card-hint" data-i18n="hint_auth_expire">Days before login sessions expire</div>
            </div>
            <div class="card-control">
              <div style="display:flex;align-items:center;gap:8px">
                <input id="s-web-session-age" type="number" class="f-input f-input-sm" min="1">
                <span class="stat-muted" data-i18n="unit_days">days</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Transcripts -->
      <div class="section">
        <div class="section-header" data-i18n="sec_transcripts">Transcripts</div>
        <div class="card">
          <div class="card-row">
            <div class="card-label" data-i18n="lbl_tx_max_files">Max Files</div>
            <div class="card-control"><input id="s-tx-max-files" type="number" class="f-input f-input-sm" min="1"></div>
          </div>
          <div class="card-row">
            <div class="card-label" data-i18n="lbl_tx_age">Retention</div>
            <div class="card-control">
              <div style="display:flex;align-items:center;gap:8px">
                <input id="s-tx-age" type="number" class="f-input f-input-sm" min="1">
                <span class="stat-muted" data-i18n="unit_days">days</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cron -->
      <div class="section">
        <div class="section-header" data-i18n="sec_cron">Cron</div>
        <div class="card">
          <div class="card-row">
            <div class="card-label" data-i18n="lbl_cron_enabled">Enabled</div>
            <div class="card-control"><label><input type="checkbox" id="s-cron-enabled"> <span data-i18n="on">On</span></label></div>
          </div>
          <div class="card-row">
            <div class="card-label" data-i18n="lbl_cron_max_concurrent">Max Concurrent Runs</div>
            <div class="card-control"><input id="s-cron-max" type="number" class="f-input f-input-sm" min="0"></div>
          </div>
        </div>
      </div>

      <!-- Save button -->
      <div style="display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:4px">
        <span class="save-status" id="settings-status"></span>
        <button class="btn btn-primary" id="save-settings-btn" data-i18n="btn_save">Save</button>
      </div>
    </div>

    <!-- ============ Models Tab ============ -->
    <div id="tab-models" class="tab-panel">
      <h1 class="page-title" data-i18n="tab_models">Models</h1>
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" id="model-add-btn" data-i18n="btn_add_model">+ Add Model</button>
        <button class="btn btn-ghost btn-sm" id="model-refresh-btn" style="margin-left:6px" data-i18n="btn_refresh_models">Refresh Models</button>
      </div>
      <div id="model-form" class="task-form" style="display:none">
        <h3 id="mf-title" style="margin:0 0 12px 0"></h3>
        <div class="task-form-grid">
          <div><label data-i18n="lbl_model_name">Name</label><input id="mf-name" class="f-input" placeholder="e.g. My Claude Sonnet"></div>
          <div><label data-i18n="lbl_model_provider">Provider</label>
            <select id="mf-provider" class="f-select"></select>
          </div>
          <div><label data-i18n="lbl_model_model">Model ID</label>
            <select id="mf-model-select" class="f-select"></select>
            <input id="mf-model" class="f-input" placeholder="e.g. gpt-4o, deepseek-chat" style="display:none">
          </div>
          <div id="mf-auth-apikey"><label data-i18n="lbl_model_apikey">API Key</label><input id="mf-apikey" class="f-input" type="password" placeholder="sk-..."></div>
          <div id="mf-auth-oauth" style="display:none"><label data-i18n="lbl_model_oauth">Authorization</label><div style="display:flex;align-items:center;gap:10px;padding-top:4px"><button class="btn btn-primary btn-sm" id="mf-oauth-btn" type="button" data-i18n="btn_authorize">Authorize</button><span id="mf-oauth-status" class="badge badge-gray" data-i18n="auth_not_authorized">Not authorized</span></div></div>
          <div id="mf-baseurl-wrap"><label data-i18n="lbl_model_baseurl">Base URL</label><input id="mf-baseurl" class="f-input" placeholder="Optional"></div>
          <div><label data-i18n="lbl_model_tokens">Max Context Tokens</label><input id="mf-tokens" class="f-input" type="number" value="200000"></div>
          <div><label data-i18n="lbl_model_thinking">Thinking</label>
            <select id="mf-thinking" class="f-select"><option value="off">off</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select>
          </div>
          <div><label><input type="checkbox" id="mf-default"> <span data-i18n="lbl_set_default">Set as default</span></label></div>
          <div class="task-form-full" style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
            <label style="margin-bottom:8px;display:block" data-i18n="lbl_model_cost">Cost ($/M tokens)</label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
              <div><label style="font-size:12px;color:var(--muted)" data-i18n="lbl_cost_input">Input</label><input id="mf-cost-input" class="f-input" type="number" step="0.01" min="0" placeholder="e.g. 3.00"></div>
              <div><label style="font-size:12px;color:var(--muted)" data-i18n="lbl_cost_output">Output</label><input id="mf-cost-output" class="f-input" type="number" step="0.01" min="0" placeholder="e.g. 15.00"></div>
              <div><label style="font-size:12px;color:var(--muted)" data-i18n="lbl_cost_cache_read">Cache Read</label><input id="mf-cost-cache-read" class="f-input" type="number" step="0.01" min="0" placeholder="Optional"></div>
              <div><label style="font-size:12px;color:var(--muted)" data-i18n="lbl_cost_cache_write">Cache Write</label><input id="mf-cost-cache-write" class="f-input" type="number" step="0.01" min="0" placeholder="Optional"></div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="mf-cancel" data-i18n="btn_cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="mf-save" data-i18n="btn_save">Save</button>
        </div>
      </div>
      <div id="models-wrap"></div>
      <div id="models-empty" class="empty" style="display:none" data-i18n="no_models">No models configured.</div>
    </div>

    <!-- ============ Prompts Tab ============ -->
    <div id="tab-prompts" class="tab-panel">
      <h1 class="page-title" data-i18n="tab_prompts">Prompts</h1>
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" id="prompt-add-btn" data-i18n="btn_add_prompt">+ Add Prompt</button>
      </div>
      <div id="prompt-form" class="task-form" style="display:none">
        <div class="task-form-grid">
          <div><label data-i18n="lbl_prompt_id">ID</label><input id="pf-id" class="f-input" placeholder="e.g. default"></div>
          <div><label data-i18n="lbl_prompt_name">Name</label><input id="pf-name" class="f-input" placeholder="Display name"></div>
          <div class="task-form-full"><label data-i18n="lbl_prompt_content">Content</label><textarea id="pf-content" class="f-textarea" rows="5" placeholder="System prompt content"></textarea></div>
          <div><label><input type="checkbox" id="pf-default"> <span data-i18n="lbl_set_default">Set as default</span></label></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="pf-cancel" data-i18n="btn_cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="pf-save" data-i18n="btn_save">Save</button>
        </div>
      </div>
      <div id="prompts-wrap"></div>
      <div id="prompts-empty" class="empty" style="display:none" data-i18n="no_prompts">No prompts configured.</div>
    </div>

    <!-- ============ Rules Tab ============ -->
    <div id="tab-rules" class="tab-panel">
      <h1 class="page-title" data-i18n="tab_rules">Rules</h1>
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" id="rule-add-btn" data-i18n="btn_add_rule">+ Add Rule</button>
      </div>
      <div id="rule-form" class="task-form" style="display:none">
        <div class="task-form-grid">
          <div><label data-i18n="lbl_rule_id">ID</label><input id="rf-id" class="f-input" placeholder="e.g. lang-match"></div>
          <div><label data-i18n="lbl_rule_name">Name</label><input id="rf-name" class="f-input" placeholder="Display name"></div>
          <div class="task-form-full"><label data-i18n="lbl_rule_content">Content</label><textarea id="rf-content" class="f-textarea" rows="3" placeholder="Rule text"></textarea></div>
          <div><label data-i18n="lbl_rule_order">Sort Order</label><input id="rf-order" class="f-input f-input-sm" type="number" value="0"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="rf-cancel" data-i18n="btn_cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="rf-save" data-i18n="btn_save">Save</button>
        </div>
      </div>
      <div id="rules-wrap"></div>
      <div id="rules-empty" class="empty" style="display:none" data-i18n="no_rules">No rules configured.</div>
    </div>

    <!-- ============ Users Tab ============ -->
    <div id="tab-users" class="tab-panel">
      <div id="users-list" class="sub-view active">
        <h1 class="page-title" data-i18n="tab_users">Users</h1>
        <div id="admin-stats" class="stats-grid"></div>
      </div>
      <div id="users-sessions" class="sub-view">
        <div class="breadcrumb"><a href="#" id="bc-users" data-i18n="tab_users">Users</a> &rsaquo; <span id="bc-username"></span></div>
        <h1 class="page-title" id="sessions-title"></h1>
        <div id="sessions-wrap"></div>
      </div>
      <div id="users-history" class="sub-view">
        <div class="breadcrumb">
          <a href="#" id="bc-users2" data-i18n="tab_users">Users</a> &rsaquo;
          <a href="#" id="bc-sessions-back"></a> &rsaquo;
          <span id="bc-session-name"></span>
        </div>
        <h1 class="page-title" id="history-title"></h1>
        <div id="history-wrap" class="chat-wrap"></div>
      </div>
    </div>

    <!-- ============ Invites Tab ============ -->
    <div id="tab-invites" class="tab-panel">
      <h1 class="page-title" data-i18n="tab_invites">Invite Codes</h1>
      <div class="create-row">
        <input id="label-input" class="f-input" placeholder="Label (optional)" maxlength="100">
        <button class="btn btn-primary" id="create-btn" data-i18n="btn_create">Create</button>
      </div>
      <div id="invites-table-wrap"></div>
      <div id="invites-empty" class="empty" style="display:none" data-i18n="no_invites">No invite codes yet.</div>
    </div>

    <!-- ============ Memory Tab ============ -->
    <div id="tab-memory" class="tab-panel">
      <h1 class="page-title" data-i18n="tab_memory">Memory</h1>

      <!-- Enable/Disable -->
      <div class="section">
        <div class="section-header">Configuration</div>
        <div class="card">
          <div class="card-row">
            <div class="card-label">Enable Memory</div>
            <div class="card-control"><label class="toggle"><input id="mem-enabled" type="checkbox"><span class="slider"></span></label></div>
          </div>
          <div class="card-row">
            <div class="card-label">Embedding Provider</div>
            <div class="card-control">
              <select id="mem-provider" class="f-input f-input-sm">
                <option value="auto">auto (detect available)</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="voyage">Voyage</option>
                <option value="mistral">Mistral</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
          </div>
          <div class="card-row">
            <div class="card-label">Fallback Provider</div>
            <div class="card-control">
              <select id="mem-fallback" class="f-input f-input-sm">
                <option value="none">none</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="voyage">Voyage</option>
                <option value="mistral">Mistral</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
          </div>
          <div class="card-row">
            <div class="card-label">Embedding Model</div>
            <div class="card-control"><input id="mem-model" type="text" class="f-input f-input-sm" placeholder="(auto based on provider)"></div>
          </div>
          <div class="card-row">
            <div class="card-label">Citations</div>
            <div class="card-control">
              <select id="mem-citations" class="f-input f-input-sm">
                <option value="auto">auto</option>
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
            </div>
          </div>
          <div class="card-row">
            <div class="card-label">Sources</div>
            <div class="card-control">
              <label><input type="checkbox" id="mem-src-memory" checked> memory</label>
              <label style="margin-left:8px"><input type="checkbox" id="mem-src-sessions"> sessions</label>
            </div>
          </div>
          <div class="card-row">
            <div class="card-label">Chunk Tokens / Overlap</div>
            <div class="card-control" style="display:flex;gap:8px">
              <input id="mem-chunk-tokens" type="number" class="f-input f-input-sm" style="width:80px" value="400">
              <input id="mem-chunk-overlap" type="number" class="f-input f-input-sm" style="width:80px" value="80">
            </div>
          </div>
          <div class="card-row">
            <div class="card-label">Max Results / Min Score</div>
            <div class="card-control" style="display:flex;gap:8px">
              <input id="mem-max-results" type="number" class="f-input f-input-sm" style="width:80px" value="6">
              <input id="mem-min-score" type="number" step="0.01" class="f-input f-input-sm" style="width:80px" value="0.35">
            </div>
          </div>
          <div class="card-row">
            <div class="card-label">Hybrid Search</div>
            <div class="card-control"><label class="toggle"><input id="mem-hybrid" type="checkbox" checked><span class="slider"></span></label></div>
          </div>
          <div class="card-row">
            <div class="card-label">Sync Interval (min)</div>
            <div class="card-control"><input id="mem-sync-interval" type="number" class="f-input f-input-sm" style="width:80px" value="5"></div>
          </div>
        </div>
      </div>

      <!-- Per-provider API keys -->
      <div class="section">
        <div class="section-header">Provider API Keys</div>
        <div class="card">
          <div class="card-row"><div class="card-label">OpenAI</div><div class="card-control" style="display:flex;gap:8px"><input id="mem-pk-openai" type="password" class="f-input f-input-sm" placeholder="sk-... (or auto from model)"><input id="mem-pu-openai" type="text" class="f-input f-input-sm" placeholder="Base URL"></div></div>
          <div class="card-row"><div class="card-label">Gemini</div><div class="card-control" style="display:flex;gap:8px"><input id="mem-pk-gemini" type="password" class="f-input f-input-sm" placeholder="API Key"><input id="mem-pu-gemini" type="text" class="f-input f-input-sm" placeholder="Base URL"></div></div>
          <div class="card-row"><div class="card-label">Voyage</div><div class="card-control" style="display:flex;gap:8px"><input id="mem-pk-voyage" type="password" class="f-input f-input-sm" placeholder="API Key"><input id="mem-pu-voyage" type="text" class="f-input f-input-sm" placeholder="Base URL"></div></div>
          <div class="card-row"><div class="card-label">Mistral</div><div class="card-control" style="display:flex;gap:8px"><input id="mem-pk-mistral" type="password" class="f-input f-input-sm" placeholder="API Key"><input id="mem-pu-mistral" type="text" class="f-input f-input-sm" placeholder="Base URL"></div></div>
          <div class="card-row"><div class="card-label">Ollama</div><div class="card-control" style="display:flex;gap:8px"><input id="mem-pk-ollama" type="password" class="f-input f-input-sm" placeholder="API Key (optional)"><input id="mem-pu-ollama" type="text" class="f-input f-input-sm" placeholder="http://localhost:11434"></div></div>
          <div class="card-row" style="justify-content:flex-end;gap:8px">
            <button class="btn btn-primary" id="mem-save-btn">Save</button>
          </div>
        </div>
      </div>

      <!-- Status -->
      <div class="section">
        <div class="section-header">Status</div>
        <div class="card" id="mem-status-card">
          <div class="card-row"><div class="card-label">Status</div><div class="card-control" id="mem-status-text">—</div></div>
          <div class="card-row"><div class="card-label">Files / Chunks</div><div class="card-control" id="mem-files-chunks">—</div></div>
          <div class="card-row"><div class="card-label">FTS</div><div class="card-control" id="mem-fts-status">—</div></div>
          <div class="card-row"><div class="card-label">Cache</div><div class="card-control" id="mem-cache-status">—</div></div>
          <div class="card-row" style="justify-content:flex-end;gap:8px">
            <button class="btn" id="mem-sync-btn">Sync Now</button>
          </div>
        </div>
      </div>

      <!-- Search test -->
      <div class="section">
        <div class="section-header">Search Test</div>
        <div class="card">
          <div class="card-row" style="gap:8px">
            <input id="mem-search-query" class="f-input" placeholder="Search query...">
            <button class="btn btn-primary" id="mem-search-btn">Search</button>
          </div>
          <div id="mem-search-results" style="margin-top:12px;font-size:13px;white-space:pre-wrap;max-height:400px;overflow-y:auto"></div>
        </div>
      </div>
    </div>

  </div></main>
</div>
<div class="toast" id="toast"></div>

<script>
(function(){
  // --- Theme sync (with parent page) ---
  function applyTheme(t) {
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else if (t === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(localStorage.getItem("klaus_theme") || "auto");

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function(r) {
      if (!r.ok) { location.href = "/login"; throw new Error("not auth"); }
      return r.json();
    })
    .then(function(data) {
      if (data.user.role !== "admin") { location.href = "/"; return; }
      initAdmin();
    })
    .catch(function() {});
  return;

  function initAdmin() {

  // Admin panel is always loaded as an iframe inside chat UI — hide redundant navigation
  var sf = document.querySelector(".sidebar-footer");
  if (sf) sf.style.display = "none";
  var nb = document.querySelector(".nav-back");
  if (nb) nb.style.display = "none";

  // --- i18n ---
  var I18N = {
    en: {
      admin_title: "Admin",
      tab_settings: "Settings", tab_models: "Models", tab_prompts: "Prompts", tab_rules: "Rules", tab_users: "Users", tab_invites: "Invites", tab_memory: "Memory",
      back_chat: "Back to Chat", back_klaus: "Back to Klaus",
      sec_general: "General", sec_agent: "Agent", sec_web: "Web Server", sec_session: "Chat Sessions", sec_transcripts: "Transcripts", sec_cron: "Cron",
      lbl_persona: "System Prompt",
      lbl_max_sessions: "Max Sessions", lbl_yolo: "Auto-approve Tools",
      lbl_auth_expire: "Auth Session Expiry",
      hint_auth_expire: "Days before login sessions expire",
      lbl_tx_max_files: "Max Files", lbl_tx_age: "Retention",
      lbl_cron_enabled: "Enabled", lbl_cron_max_concurrent: "Max Concurrent Runs",
      unit_days: "days", unit_minutes: "min",
      btn_save: "Save", btn_create: "Create", btn_cancel: "Cancel",
      on: "On", off: "Off",
      saved: "Saved!", failed: "Failed",
      no_invites: "No invite codes yet.",
      code: "Code", label: "Label", created: "Created", actions: "Actions",
      copy_code: "Copy", delete: "Delete", used_codes: "Used Codes", used_by: "Used By", used_at: "Used At",
      code_copied: "Code copied!", confirm_delete: "Delete this?", deleted: "Deleted",
      created_copied: "Created! Code copied", created_ok: "Created!",
      sessions_label: "sessions", msgs_label: "msgs",
      no_sessions: "No sessions found", no_messages: "No messages in this session",
      btn_add_model: "+ Add Model", btn_refresh_models: "Refresh Models", btn_add_prompt: "+ Add Prompt", btn_add_rule: "+ Add Rule",
      lbl_model_id: "ID", lbl_model_name: "Name", lbl_model_provider: "Provider", lbl_model_model: "Model ID",
      lbl_model_apikey: "API Key", lbl_model_baseurl: "Base URL", lbl_model_tokens: "Max Context Tokens", lbl_model_thinking: "Thinking",
      lbl_model_cost: "Cost ($/M tokens)", lbl_cost_input: "Input", lbl_cost_output: "Output", lbl_cost_cache_read: "Cache Read", lbl_cost_cache_write: "Cache Write",
      lbl_set_default: "Set as default", no_models: "No models configured.",
      lbl_prompt_id: "ID", lbl_prompt_name: "Name", lbl_prompt_content: "Content", no_prompts: "No prompts configured.",
      lbl_rule_id: "ID", lbl_rule_name: "Name", lbl_rule_content: "Content", lbl_rule_order: "Sort Order", no_rules: "No rules configured.",
      default_badge: "Default", enabled_badge: "Enabled", disabled_badge: "Disabled",
      confirm_delete_model: "Delete this model?", confirm_delete_prompt: "Delete this prompt?", confirm_delete_rule: "Delete this rule?",
      models_refreshed: "Models refreshed", btn_authorize: "Authorize", auth_authorized: "Authorized", auth_not_authorized: "Not authorized", auth_save_first: "Save model first", lbl_model_oauth: "Authorization", lbl_add_model: "Add Model", lbl_edit_model: "Edit Model", lbl_custom_model: "Custom...",
      sec_auth: "Authentication", sec_mode: "Mode", sec_thirdparty: "Third-party API", sec_model_map: "Model Mapping",
      lbl_auth_status: "Status", lbl_mode: "Mode", lbl_default_model: "Default Model",
      lbl_base_url: "API Base URL", lbl_auth_token: "Auth Token", lbl_api_timeout: "API Timeout (ms)",
      btn_login: "Login", login_pending: "Waiting for login...", login_failed: "Login failed",
      logged_in_as: "Logged in as", logged_in: "Logged in", not_logged_in: "Not logged in",
    },
    zh: {
      admin_title: "管理面板",
      tab_settings: "设置", tab_models: "模型", tab_prompts: "提示词", tab_rules: "规则", tab_users: "用户", tab_invites: "邀请码", tab_memory: "记忆",
      back_chat: "返回对话", back_klaus: "返回 Klaus",
      sec_general: "通用", sec_agent: "Agent", sec_web: "Web 服务器", sec_session: "对话会话", sec_transcripts: "历史记录", sec_cron: "定时任务",
      lbl_persona: "系统提示词",
      lbl_max_sessions: "最大会话数", lbl_yolo: "自动批准工具",
      lbl_auth_expire: "登录过期时间",
      hint_auth_expire: "登录会话过期天数",
      lbl_tx_max_files: "最大文件数", lbl_tx_age: "保留时间",
      lbl_cron_enabled: "启用", lbl_cron_max_concurrent: "最大并发数",
      unit_days: "天", unit_minutes: "分钟",
      btn_save: "保存", btn_create: "创建", btn_cancel: "取消",
      on: "开启", off: "关闭",
      saved: "已保存!", failed: "失败",
      no_invites: "还没有邀请码。",
      code: "代码", label: "标签", created: "创建时间", actions: "操作",
      copy_code: "复制", delete: "删除", used_codes: "已使用", used_by: "使用者", used_at: "使用时间",
      code_copied: "已复制!", confirm_delete: "确定删除？", deleted: "已删除",
      created_copied: "已创建并复制!", created_ok: "已创建!",
      sessions_label: "会话", msgs_label: "消息",
      no_sessions: "暂无会话", no_messages: "该会话暂无消息",
      btn_add_model: "+ 添加模型", btn_refresh_models: "刷新模型", btn_add_prompt: "+ 添加提示词", btn_add_rule: "+ 添加规则",
      lbl_model_id: "ID", lbl_model_name: "名称", lbl_model_provider: "提供商", lbl_model_model: "模型 ID",
      lbl_model_apikey: "API Key", lbl_model_baseurl: "API 地址", lbl_model_tokens: "最大上下文 Token", lbl_model_thinking: "思考",
      lbl_model_cost: "成本 ($/百万 Token)", lbl_cost_input: "输入", lbl_cost_output: "输出", lbl_cost_cache_read: "缓存读取", lbl_cost_cache_write: "缓存写入",
      lbl_set_default: "设为默认", no_models: "暂无模型配置。",
      lbl_prompt_id: "ID", lbl_prompt_name: "名称", lbl_prompt_content: "内容", no_prompts: "暂无提示词配置。",
      lbl_rule_id: "ID", lbl_rule_name: "名称", lbl_rule_content: "内容", lbl_rule_order: "排序", no_rules: "暂无规则配置。",
      default_badge: "默认", enabled_badge: "启用", disabled_badge: "禁用",
      confirm_delete_model: "确定删除此模型？", confirm_delete_prompt: "确定删除此提示词？", confirm_delete_rule: "确定删除此规则？",
      models_refreshed: "模型已刷新", btn_authorize: "授权", auth_authorized: "已授权", auth_not_authorized: "未授权", auth_save_first: "请先保存模型", lbl_model_oauth: "授权", lbl_add_model: "添加模型", lbl_edit_model: "编辑模型", lbl_custom_model: "自定义...",
      sec_auth: "认证", sec_mode: "模式", sec_thirdparty: "第三方 API", sec_model_map: "模型映射",
      lbl_auth_status: "状态", lbl_mode: "模式", lbl_default_model: "默认模型",
      lbl_base_url: "API 地址", lbl_auth_token: "认证令牌", lbl_api_timeout: "API 超时 (ms)",
      btn_login: "登录", login_pending: "等待登录...", login_failed: "登录失败",
      logged_in_as: "已登录：", logged_in: "已登录", not_logged_in: "未登录",
    }
  };
  var lang = localStorage.getItem("klaus_lang") || "en";
  function tt(k) { return (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k; }
  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function(el) { el.textContent = tt(el.getAttribute("data-i18n")); });
  }
  applyI18n();

  // Listen for language/theme changes from parent page (via postMessage)
  window.addEventListener("message", function(e) {
    if (!e.data || e.data.type !== "klaus-settings") return;
    if (e.data.lang && I18N[e.data.lang]) { lang = e.data.lang; applyI18n(); }
    if (e.data.theme !== undefined) { applyTheme(e.data.theme); }
  });

  // --- Helpers ---
  function esc(s) { if (s == null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  var toastEl = document.getElementById("toast"), toastTimer;
  function showToast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function() { toastEl.classList.remove("show"); }, 2000); }
  function fmtRel(ts) { if (!ts) return "-"; var d = Date.now() - ts; if (d < 60000) return "just now"; if (d < 3600000) return Math.floor(d/60000) + "m ago"; if (d < 86400000) return Math.floor(d/3600000) + "h ago"; return Math.floor(d/86400000) + "d ago"; }

  function api(path, method, params) {
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
    return fetch(url, opts).then(function(r) { return r.json(); });
  }

  // --- Tab Navigation ---
  var navItems = document.querySelectorAll(".nav-item[data-tab]");
  var tabPanels = document.querySelectorAll(".tab-panel");
  function switchTab(id) {
    navItems.forEach(function(n) { n.classList.toggle("active", n.dataset.tab === id); });
    tabPanels.forEach(function(p) { p.classList.toggle("active", p.id === "tab-" + id); });
    if (id === "users") showSubView("users-list");
    if (id === "models") loadProviders().then(loadModels);
    if (id === "prompts") loadPrompts();
    if (id === "rules") loadRules();
  }
  navItems.forEach(function(b) { b.addEventListener("click", function() { switchTab(b.dataset.tab); }); });

  // =====================================================
  // SETTINGS TAB
  // =====================================================
  var sMaxSessions = document.getElementById("s-max-sessions");
  var sYolo = document.getElementById("s-yolo");
  var sWebSesAge = document.getElementById("s-web-session-age");
  var sTxMaxFiles = document.getElementById("s-tx-max-files");
  var sTxAge = document.getElementById("s-tx-age");
  var sCronEnabled = document.getElementById("s-cron-enabled");
  var sCronMax = document.getElementById("s-cron-max");
  var saveBtn = document.getElementById("save-settings-btn");
  var saveStatus = document.getElementById("settings-status");

  function loadSettings() {
    api("settings", "GET").then(function(d) {
      sMaxSessions.value = d.max_sessions || 20;
      sYolo.checked = d.yolo !== false;
      sWebSesAge.value = (d.web && d.web.session_max_age_days) || 7;
      sTxMaxFiles.value = (d.transcripts && d.transcripts.max_files) || 200;
      sTxAge.value = (d.transcripts && d.transcripts.max_age_days) || 30;
      sCronEnabled.checked = d.cron && d.cron.enabled;
      sCronMax.value = (d.cron && d.cron.max_concurrent_runs) || 0;
    });
  }

  saveBtn.onclick = function() {
    saveBtn.disabled = true;
    api("settings", "PATCH", {
      max_sessions: parseInt(sMaxSessions.value, 10) || 20,
      yolo: sYolo.checked,
      web: { session_max_age_days: parseInt(sWebSesAge.value, 10) || 7 },
      transcripts: {
        max_files: parseInt(sTxMaxFiles.value, 10) || 200,
        max_age_days: parseInt(sTxAge.value, 10) || 30,
      },
      cron: {
        enabled: sCronEnabled.checked,
        max_concurrent_runs: parseInt(sCronMax.value, 10) || 0,
      },
    })
    .then(function() {
      saveStatus.textContent = tt("saved"); saveStatus.style.color = "var(--success)";
      saveStatus.style.opacity = "1";
      setTimeout(function() { saveStatus.style.opacity = "0"; }, 2000);
    })
    .catch(function() {
      saveStatus.textContent = tt("failed"); saveStatus.style.color = "var(--danger)";
      saveStatus.style.opacity = "1";
      setTimeout(function() { saveStatus.style.opacity = "0"; }, 2000);
    })
    .finally(function() { saveBtn.disabled = false; });
  };

  loadSettings();

  // =====================================================
  // USERS TAB
  // =====================================================
  function showSubView(id) {
    document.querySelectorAll("#tab-users .sub-view").forEach(function(v) { v.classList.toggle("active", v.id === id); });
  }
  var sessUserId = "", sessLabel = "";

  function loadUsers() {
    api("users", "GET").then(function(d) {
      var users = d.users || [];
      var el = document.getElementById("admin-stats");
      el.innerHTML = users.map(function(u) {
        return "<div class='stat-card' data-uid='" + esc(u.id) + "'>"
          + "<div class='stat-label'>" + esc(u.displayName) + " <span style='font-size:10px'>(" + esc(u.role) + ")</span></div>"
          + "<div class='stat-value'>" + esc(String(u.sessionCount || 0)) + " <span style='font-size:13px;font-weight:400;color:var(--muted)'>" + tt("sessions_label") + "</span></div>"
          + "<div class='stat-detail'>" + esc(u.email) + " &middot; " + esc(String(u.totalMessages || 0)) + " " + tt("msgs_label") + "</div>"
          + "</div>";
      }).join("");
      el.querySelectorAll(".stat-card[data-uid]").forEach(function(c) {
        c.onclick = function() {
          var u = users.find(function(u) { return u.id === c.dataset.uid; });
          openSessions(c.dataset.uid, u ? u.displayName : "User");
        };
      });
    });
  }

  function openSessions(uid, label) {
    sessUserId = uid; sessLabel = label;
    document.getElementById("bc-username").textContent = label;
    document.getElementById("sessions-title").textContent = label;
    showSubView("users-sessions");
    var wrap = document.getElementById("sessions-wrap");
    wrap.innerHTML = "<div class='empty'>Loading...</div>";
    api("sessions", "GET", { userId: uid }).then(function(d) {
      var s = d.sessions || [];
      if (!s.length) { wrap.innerHTML = "<div class='empty'>" + esc(tt("no_sessions")) + "</div>"; return; }
      var h = "<table><thead><tr><th>Title</th><th>Messages</th><th>Model</th><th>Updated</th></tr></thead><tbody>";
      s.forEach(function(x) {
        h += "<tr class='clickable' data-sid='" + esc(x.sessionId) + "' data-st='" + esc(x.title) + "'>"
          + "<td>" + esc(x.title) + "</td>"
          + "<td class='stat'>" + esc(String(x.messageCount)) + "</td>"
          + "<td>" + (x.model ? "<span class='model-tag'>" + esc(x.model) + "</span>" : "<span class='stat-muted'>-</span>") + "</td>"
          + "<td class='stat-muted'>" + esc(fmtRel(x.updatedAt)) + "</td></tr>";
      });
      h += "</tbody></table>";
      wrap.innerHTML = h;
    });
  }

  document.getElementById("sessions-wrap").addEventListener("click", function(e) {
    var row = e.target.closest("tr[data-sid]");
    if (row) openHistory(row.dataset.sid, row.dataset.st);
  });

  function openHistory(sid, title) {
    document.getElementById("bc-sessions-back").textContent = sessLabel;
    document.getElementById("bc-session-name").textContent = title;
    document.getElementById("history-title").textContent = title;
    showSubView("users-history");
    var wrap = document.getElementById("history-wrap");
    wrap.innerHTML = "<div class='empty'>Loading...</div>";
    api("history", "GET", { userId: sessUserId, sessionId: sid }).then(function(d) {
      var msgs = d.messages || [];
      if (!msgs.length) { wrap.innerHTML = "<div class='empty'>" + esc(tt("no_messages")) + "</div>"; return; }
      wrap.innerHTML = msgs.map(function(m) {
        return "<div class='chat-msg " + esc(m.role) + "'><div class='chat-role'>" + esc(m.role) + "</div>" + renderMd(m.content) + "</div>";
      }).join("");
    });
  }

  function renderMd(text) {
    var s = esc(text);
    s = s.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, function(_,l,c) { return "<pre><code>" + c.replace(/\\n$/,"") + "</code></pre>"; });
    s = s.replace(/\`([^\`]+)\`/g, function(_,c) { return "<code>"+c+"</code>"; });
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>");
    var parts = s.split(/(<pre>[\\s\\S]*?<\\/pre>)/g);
    return parts.map(function(p,i) { return i%2===0 ? p.replace(/\\n/g,"<br>") : p; }).join("");
  }

  document.getElementById("bc-users").onclick = function(e) { e.preventDefault(); showSubView("users-list"); };
  document.getElementById("bc-users2").onclick = function(e) { e.preventDefault(); showSubView("users-list"); };
  document.getElementById("bc-sessions-back").onclick = function(e) { e.preventDefault(); openSessions(sessUserId, sessLabel); };
  loadUsers();

  // =====================================================
  // INVITES TAB
  // =====================================================
  var invWrap = document.getElementById("invites-table-wrap");
  var invEmpty = document.getElementById("invites-empty");

  function loadInvites() {
    api("invites", "GET").then(function(d) {
      var codes = d.invites || [];
      if (!codes.length) { invWrap.innerHTML = ""; invEmpty.style.display = "block"; return; }
      invEmpty.style.display = "none";
      var active = codes.filter(function(c) { return c.isActive; });
      var used = codes.filter(function(c) { return !c.isActive; });
      var h = "";
      if (active.length) {
        h += "<table><thead><tr><th>" + tt("code") + "</th><th>" + tt("label") + "</th><th>" + tt("created") + "</th><th>" + tt("actions") + "</th></tr></thead><tbody>";
        active.forEach(function(c) {
          h += "<tr><td><span class='code-text'>" + esc(c.code.slice(0,8)) + "...</span></td>"
            + "<td>" + esc(c.label || "-") + "</td><td class='stat-muted'>" + esc(fmtRel(c.createdAt)) + "</td>"
            + "<td><div class='actions'><button class='btn btn-sm btn-copy' data-code='" + esc(c.code) + "'>" + tt("copy_code") + "</button>"
            + "<button class='btn btn-sm btn-danger' data-del='" + esc(c.code) + "'>" + tt("delete") + "</button></div></td></tr>";
        });
        h += "</tbody></table>";
      }
      if (used.length) {
        h += "<div style='margin-top:20px;font-weight:600;font-size:13px;color:var(--muted)'>" + tt("used_codes") + "</div>";
        h += "<table><thead><tr><th>" + tt("code") + "</th><th>" + tt("label") + "</th><th>" + tt("used_by") + "</th><th>" + tt("used_at") + "</th></tr></thead><tbody>";
        used.forEach(function(c) {
          h += "<tr style='opacity:0.7'><td><span class='code-text'>" + esc(c.code.slice(0,8)) + "...</span></td>"
            + "<td>" + esc(c.label || "-") + "</td><td>" + esc(c.usedBy || "-") + "</td>"
            + "<td class='stat-muted'>" + (c.usedAt ? esc(fmtRel(c.usedAt)) : "-") + "</td></tr>";
        });
        h += "</tbody></table>";
      }
      invWrap.innerHTML = h;
    });
  }

  invWrap.addEventListener("click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.code) navigator.clipboard.writeText(btn.dataset.code).then(function() { showToast(tt("code_copied")); });
    else if (btn.dataset.del) { if (!confirm(tt("confirm_delete"))) return; api("invites", "DELETE", { code: btn.dataset.del }).then(function() { loadInvites(); showToast(tt("deleted")); }); }
  });

  var createBtn = document.getElementById("create-btn");
  var labelInput = document.getElementById("label-input");
  createBtn.onclick = function() {
    api("invites", "POST", { label: labelInput.value.trim() }).then(function(d) {
      labelInput.value = "";
      if (d.invite) navigator.clipboard.writeText(d.invite.code).then(function() { showToast(tt("created_copied")); }).catch(function() { showToast(tt("created_ok")); });
      loadInvites();
    });
  };
  labelInput.addEventListener("keydown", function(e) { if (e.key === "Enter") createBtn.onclick(); });
  loadInvites();

  // =====================================================
  // MODELS TAB
  // =====================================================
  var PROVIDER_PRESETS = {};
  var providersLoaded = false;

  function loadProviders(refresh) {
    if (providersLoaded && !refresh) return Promise.resolve();
    var qs = refresh ? "providers?refresh=1" : "providers";
    return api(qs, "GET").then(function(d) {
      var providers = d.providers || [];
      PROVIDER_PRESETS = {};
      mfProvider.innerHTML = "";
      providers.forEach(function(p) {
        PROVIDER_PRESETS[p.id] = { baseUrl: p.defaultBaseUrl, models: p.models, auth: p.auth };
        var o = document.createElement("option");
        o.value = p.id; o.textContent = p.label;
        mfProvider.appendChild(o);
      });
      providersLoaded = true;
    });
  }
  loadProviders();

  var modelsWrap = document.getElementById("models-wrap");
  var modelsEmpty = document.getElementById("models-empty");
  var modelForm = document.getElementById("model-form");
  var modelAddBtn = document.getElementById("model-add-btn");
  var modelRefreshBtn = document.getElementById("model-refresh-btn");
  var mfName = document.getElementById("mf-name");
  var mfProvider = document.getElementById("mf-provider");
  var mfModelSelect = document.getElementById("mf-model-select");
  var mfModel = document.getElementById("mf-model");
  var mfApikey = document.getElementById("mf-apikey");
  var mfBaseurlWrap = document.getElementById("mf-baseurl-wrap");
  var mfBaseurl = document.getElementById("mf-baseurl");
  var mfTokens = document.getElementById("mf-tokens");
  var mfThinking = document.getElementById("mf-thinking");
  var mfDefault = document.getElementById("mf-default");
  var mfCostInput = document.getElementById("mf-cost-input");
  var mfCostOutput = document.getElementById("mf-cost-output");
  var mfCostCacheRead = document.getElementById("mf-cost-cache-read");
  var mfCostCacheWrite = document.getElementById("mf-cost-cache-write");
  var mfAuthApikey = document.getElementById("mf-auth-apikey");
  var mfAuthOauth = document.getElementById("mf-auth-oauth");
  var mfOauthBtn = document.getElementById("mf-oauth-btn");
  var mfOauthStatus = document.getElementById("mf-oauth-status");
  var mfSave = document.getElementById("mf-save");
  var mfCancel = document.getElementById("mf-cancel");
  var mfTitle = document.getElementById("mf-title");
  var editingModelId = null;

  function isPresetProvider(pv) { return PROVIDER_PRESETS.hasOwnProperty(pv); }

  function getSelectedModel() {
    var pv = mfProvider.value;
    if (isPresetProvider(pv)) {
      return mfModelSelect.value === "__custom__" ? mfModel.value.trim() : mfModelSelect.value;
    }
    return mfModel.value.trim();
  }

  function syncProviderUI(provider, currentModel) {
    var preset = PROVIDER_PRESETS[provider];
    // Switch auth UI based on method type
    var isOAuth = preset && preset.auth && preset.auth.method && preset.auth.method.type === "oauth";
    mfAuthApikey.style.display = isOAuth ? "none" : "";
    mfAuthOauth.style.display = isOAuth ? "" : "none";
    if (isOAuth) {
      mfOauthBtn.disabled = false;
      mfOauthBtn.title = "";
    }
    if (preset) {
      // Preset provider: show select + optional custom input
      mfModelSelect.style.display = "";
      mfModel.style.display = "none";
      mfModelSelect.innerHTML = "";
      preset.models.forEach(function(m) {
        var o = document.createElement("option");
        o.value = m.id; o.textContent = m.label;
        mfModelSelect.appendChild(o);
      });
      // Add "Custom..." option for dynamic model IDs
      var customOpt = document.createElement("option");
      customOpt.value = "__custom__"; customOpt.textContent = tt("lbl_custom_model") || "Custom...";
      mfModelSelect.appendChild(customOpt);
      if (currentModel) {
        var found = preset.models.some(function(m) { return m.id === currentModel; });
        if (found) {
          mfModelSelect.value = currentModel;
        } else {
          // Unknown model ID — show custom input
          mfModelSelect.value = "__custom__";
          mfModel.style.display = "";
          mfModel.value = currentModel;
        }
      }
      // Show baseUrl as read-only for preset providers
      mfBaseurlWrap.style.display = "";
      mfBaseurl.value = preset.baseUrl || "";
      mfBaseurl.readOnly = true;
      // Auto-fill tokens from selected model
      syncModelTokens();
    } else {
      // Custom/compatible provider: show input, hide select
      mfModelSelect.style.display = "none";
      mfModel.style.display = "";
      if (currentModel) mfModel.value = currentModel;
      mfBaseurlWrap.style.display = "";
      mfBaseurl.readOnly = false;
    }
  }

  function syncModelTokens() {
    var pv = mfProvider.value;
    var preset = PROVIDER_PRESETS[pv];
    if (!preset) return;
    var selId = mfModelSelect.value;
    var found = preset.models.find(function(m) { return m.id === selId; });
    if (found) mfTokens.value = found.tokens;
  }

  mfProvider.addEventListener("change", function() { syncProviderUI(mfProvider.value, ""); });
  mfModelSelect.addEventListener("change", function() {
    if (mfModelSelect.value === "__custom__") {
      mfModel.style.display = "";
      mfModel.value = "";
      mfModel.focus();
    } else {
      mfModel.style.display = "none";
      syncModelTokens();
    }
  });

  function loadModels() {
    api("models", "GET").then(function(d) {
      var models = d.models || [];
      if (!models.length) { modelsWrap.innerHTML = ""; modelsEmpty.style.display = "block"; return; }
      modelsEmpty.style.display = "none";
      var h = "<table><thead><tr><th>ID</th><th>" + tt("lbl_model_name") + "</th><th>" + tt("lbl_model_provider") + "</th><th>" + tt("lbl_model_model") + "</th><th>" + tt("lbl_model_thinking") + "</th><th>Status</th><th>" + tt("actions") + "</th></tr></thead><tbody>";
      models.forEach(function(m) {
        var badge = m.isDefault ? "<span class='badge badge-green'>" + tt("default_badge") + "</span>" : "";
        h += "<tr>"
          + "<td><span class='code-text'>" + esc(m.id) + "</span></td>"
          + "<td>" + esc(m.name) + "</td>"
          + "<td>" + esc(m.provider) + "</td>"
          + "<td>" + esc(m.model) + "</td>"
          + "<td>" + esc(m.thinking || "off") + "</td>"
          + "<td>" + badge + "</td>"
          + "<td><div class='actions'>"
          + (m.isDefault ? "" : "<button class='btn btn-sm btn-ghost' data-setdefault='" + esc(m.id) + "'>" + tt("lbl_set_default") + "</button>")
          + "<button class='btn btn-sm btn-ghost' data-editmodel='" + esc(m.id) + "'>Edit</button>"
          + "<button class='btn btn-sm btn-danger' data-delmodel='" + esc(m.id) + "'>" + tt("delete") + "</button>"
          + "</div></td></tr>";
      });
      h += "</tbody></table>";
      modelsWrap.innerHTML = h;
    });
  }

  function openOAuthPopup(provider, modelId) {
    window.open("/auth/provider/start?provider=" + encodeURIComponent(provider) + "&modelId=" + encodeURIComponent(modelId), "_blank", "width=600,height=700");
  }

  mfOauthBtn.onclick = function() {
    var model = getSelectedModel();
    var provider = mfProvider.value.trim();
    if (!model || !provider) return;
    var id = editingModelId || (provider + "-" + model).replace(/[^a-zA-Z0-9._-]/g, "-");

    if (editingModelId) {
      // Already saved — just open OAuth popup
      openOAuthPopup(provider, id);
    } else {
      // Auto-save model first, then open OAuth popup
      var payload = {
        id: id, name: mfName.value.trim() || model, provider: provider,
        model: model, max_context_tokens: parseInt(mfTokens.value, 10) || 200000,
        thinking: mfThinking.value, is_default: mfDefault.checked
      };
      if (mfBaseurl.value.trim()) payload.base_url = mfBaseurl.value.trim();
      mfOauthBtn.disabled = true;
      // Use PATCH if model already exists, POST otherwise
      api("models", "GET").then(function(d) {
        var exists = (d.models || []).some(function(x) { return x.id === id; });
        var method = exists ? "PATCH" : "POST";
        var path = exists ? "models?id=" + encodeURIComponent(id) : "models";
        return api(path, method, payload);
      })
        .then(function() {
          editingModelId = id;
          loadModels();
          openOAuthPopup(provider, id);
        })
        .catch(function() { showToast(tt("failed")); })
        .finally(function() { mfOauthBtn.disabled = false; });
    }
  };

  // Listen for OAuth completion from popup
  window.addEventListener("storage", function(e) {
    if (e.key === "klaus_oauth_done") {
      localStorage.removeItem("klaus_oauth_done");
      mfOauthStatus.textContent = tt("auth_authorized");
      mfOauthStatus.className = "badge badge-green";
      loadModels();
    }
  });

  modelRefreshBtn.onclick = function() {
    modelRefreshBtn.disabled = true;
    loadProviders(true).then(function() {
      showToast(tt("models_refreshed"));
      if (mfProvider.value) syncProviderUI(mfProvider.value, "");
    }).finally(function() { modelRefreshBtn.disabled = false; });
  };

  modelAddBtn.onclick = function() {
    editingModelId = null;
    mfTitle.textContent = tt("lbl_add_model");
    mfName.value = ""; mfModel.value = "";
    mfApikey.value = ""; mfBaseurl.value = ""; mfTokens.value = "200000"; mfThinking.value = "off"; mfDefault.checked = false;
    mfCostInput.value = ""; mfCostOutput.value = ""; mfCostCacheRead.value = ""; mfCostCacheWrite.value = "";
    var firstProvider = mfProvider.options.length ? mfProvider.options[0].value : "";
    mfProvider.value = firstProvider;
    syncProviderUI(firstProvider, "");
    modelsWrap.style.display = "none";
    modelForm.style.display = "block";
    mfName.focus();
  };
  mfCancel.onclick = function() { modelForm.style.display = "none"; modelsWrap.style.display = ""; };

  mfSave.onclick = function() {
    var model = getSelectedModel();
    var provider = mfProvider.value.trim();
    if (!model || !provider) return;
    var id = editingModelId || (provider + "-" + model).replace(/[^a-zA-Z0-9._-]/g, "-");
    mfSave.disabled = true;
    var payload = {
      id: id, name: mfName.value.trim() || model, provider: provider,
      model: model, max_context_tokens: parseInt(mfTokens.value, 10) || 200000,
      thinking: mfThinking.value, is_default: mfDefault.checked
    };
    if (mfApikey.value.trim()) payload.api_key = mfApikey.value.trim();
    if (mfBaseurl.value.trim()) payload.base_url = mfBaseurl.value.trim();
    var ci = parseFloat(mfCostInput.value), co = parseFloat(mfCostOutput.value);
    if (isFinite(ci) && isFinite(co)) {
      payload.cost_input = ci;
      payload.cost_output = co;
      var cr = parseFloat(mfCostCacheRead.value), cw = parseFloat(mfCostCacheWrite.value);
      if (isFinite(cr)) payload.cost_cache_read = cr;
      if (isFinite(cw)) payload.cost_cache_write = cw;
    }

    var method = editingModelId ? "PATCH" : "POST";
    var path = editingModelId ? "models?id=" + encodeURIComponent(editingModelId) : "models";
    api(path, method, payload)
      .then(function() { modelForm.style.display = "none"; modelsWrap.style.display = ""; showToast(tt("saved")); loadModels(); })
      .catch(function() { showToast(tt("failed")); })
      .finally(function() { mfSave.disabled = false; });
  };

  modelsWrap.addEventListener("click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.delmodel) {
      if (!confirm(tt("confirm_delete_model"))) return;
      api("models?id=" + encodeURIComponent(btn.dataset.delmodel), "DELETE").then(function() { loadModels(); showToast(tt("deleted")); });
    } else if (btn.dataset.setdefault) {
      api("models?id=" + encodeURIComponent(btn.dataset.setdefault), "PATCH", { is_default: true }).then(function() { loadModels(); });
    } else if (btn.dataset.editmodel) {
      var mid = btn.dataset.editmodel;
      api("models", "GET").then(function(d) {
        var m = (d.models || []).find(function(x) { return x.id === mid; });
        if (!m) return;
        editingModelId = mid;
        mfTitle.textContent = tt("lbl_edit_model");
        mfName.value = m.name || "";
        var pv = m.provider || "anthropic";
        if (!mfProvider.querySelector('option[value="' + pv + '"]')) {
          var opt = document.createElement("option");
          opt.value = pv; opt.textContent = pv;
          mfProvider.appendChild(opt);
        }
        mfProvider.value = pv;
        syncProviderUI(pv, m.model || "");
        mfApikey.value = ""; mfBaseurl.value = m.baseUrl || "";
        if (isPresetProvider(pv)) {
          mfBaseurlWrap.style.display = "";
          mfBaseurl.readOnly = true;
        } else {
          mfBaseurlWrap.style.display = "";
          mfBaseurl.readOnly = false;
        }
        mfTokens.value = m.maxContextTokens || 200000; mfThinking.value = m.thinking || "off";
        mfDefault.checked = m.isDefault;
        mfCostInput.value = m.cost && m.cost.input != null ? m.cost.input : "";
        mfCostOutput.value = m.cost && m.cost.output != null ? m.cost.output : "";
        mfCostCacheRead.value = m.cost && m.cost.cacheRead != null ? m.cost.cacheRead : "";
        mfCostCacheWrite.value = m.cost && m.cost.cacheWrite != null ? m.cost.cacheWrite : "";
        if (m.isAuthorized && m.authType === "oauth") {
          mfOauthStatus.textContent = tt("auth_authorized");
          mfOauthStatus.className = "badge badge-green";
        } else {
          mfOauthStatus.textContent = tt("auth_not_authorized");
          mfOauthStatus.className = "badge badge-gray";
        }
        modelsWrap.style.display = "none";
        modelForm.style.display = "block";
      });
    }
  });

  // =====================================================
  // PROMPTS TAB
  // =====================================================
  var promptsWrap = document.getElementById("prompts-wrap");
  var promptsEmpty = document.getElementById("prompts-empty");
  var promptForm = document.getElementById("prompt-form");
  var promptAddBtn = document.getElementById("prompt-add-btn");
  var pfId = document.getElementById("pf-id");
  var pfName = document.getElementById("pf-name");
  var pfContent = document.getElementById("pf-content");
  var pfDefault = document.getElementById("pf-default");
  var pfSave = document.getElementById("pf-save");
  var pfCancel = document.getElementById("pf-cancel");
  var editingPromptId = null;

  function loadPrompts() {
    api("prompts", "GET").then(function(d) {
      var prompts = d.prompts || [];
      if (!prompts.length) { promptsWrap.innerHTML = ""; promptsEmpty.style.display = "block"; return; }
      promptsEmpty.style.display = "none";
      var h = "<table><thead><tr><th>ID</th><th>" + tt("lbl_prompt_name") + "</th><th>" + tt("lbl_prompt_content") + "</th><th>Status</th><th>" + tt("actions") + "</th></tr></thead><tbody>";
      prompts.forEach(function(p) {
        var badge = p.isDefault ? "<span class='badge badge-green'>" + tt("default_badge") + "</span>" : "";
        var preview = p.content.length > 80 ? p.content.slice(0, 80) + "..." : p.content;
        h += "<tr>"
          + "<td><span class='code-text'>" + esc(p.id) + "</span></td>"
          + "<td>" + esc(p.name) + "</td>"
          + "<td class='stat-muted'>" + esc(preview) + "</td>"
          + "<td>" + badge + "</td>"
          + "<td><div class='actions'>"
          + (p.isDefault ? "" : "<button class='btn btn-sm btn-ghost' data-setdefaultprompt='" + esc(p.id) + "'>" + tt("lbl_set_default") + "</button>")
          + "<button class='btn btn-sm btn-ghost' data-editprompt='" + esc(p.id) + "'>Edit</button>"
          + "<button class='btn btn-sm btn-danger' data-delprompt='" + esc(p.id) + "'>" + tt("delete") + "</button>"
          + "</div></td></tr>";
      });
      h += "</tbody></table>";
      promptsWrap.innerHTML = h;
    });
  }

  promptAddBtn.onclick = function() {
    editingPromptId = null;
    pfId.value = ""; pfName.value = ""; pfContent.value = ""; pfDefault.checked = false;
    pfId.disabled = false;
    promptForm.style.display = "block";
    pfId.focus();
  };
  pfCancel.onclick = function() { promptForm.style.display = "none"; };

  pfSave.onclick = function() {
    var id = pfId.value.trim();
    var content = pfContent.value.trim();
    if (!id || !content) return;
    pfSave.disabled = true;
    var payload = { id: id, name: pfName.value.trim() || id, content: content, is_default: pfDefault.checked };
    var method = editingPromptId ? "PATCH" : "POST";
    var path = editingPromptId ? "prompts?id=" + encodeURIComponent(editingPromptId) : "prompts";
    api(path, method, payload)
      .then(function() { promptForm.style.display = "none"; showToast(tt("saved")); loadPrompts(); })
      .catch(function() { showToast(tt("failed")); })
      .finally(function() { pfSave.disabled = false; });
  };

  promptsWrap.addEventListener("click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.delprompt) {
      if (!confirm(tt("confirm_delete_prompt"))) return;
      api("prompts?id=" + encodeURIComponent(btn.dataset.delprompt), "DELETE").then(function() { loadPrompts(); showToast(tt("deleted")); });
    } else if (btn.dataset.setdefaultprompt) {
      api("prompts?id=" + encodeURIComponent(btn.dataset.setdefaultprompt), "PATCH", { is_default: true }).then(function() { loadPrompts(); });
    } else if (btn.dataset.editprompt) {
      var pid = btn.dataset.editprompt;
      api("prompts", "GET").then(function(d) {
        var p = (d.prompts || []).find(function(x) { return x.id === pid; });
        if (!p) return;
        editingPromptId = pid;
        pfId.value = p.id; pfId.disabled = true;
        pfName.value = p.name || ""; pfContent.value = p.content || "";
        pfDefault.checked = p.isDefault;
        promptForm.style.display = "block";
      });
    }
  });

  // =====================================================
  // RULES TAB
  // =====================================================
  var rulesWrap = document.getElementById("rules-wrap");
  var rulesEmpty = document.getElementById("rules-empty");
  var ruleForm = document.getElementById("rule-form");
  var ruleAddBtn = document.getElementById("rule-add-btn");
  var rfId = document.getElementById("rf-id");
  var rfName = document.getElementById("rf-name");
  var rfContent = document.getElementById("rf-content");
  var rfOrder = document.getElementById("rf-order");
  var rfSave = document.getElementById("rf-save");
  var rfCancel = document.getElementById("rf-cancel");
  var editingRuleId = null;

  function loadRules() {
    api("rules", "GET").then(function(d) {
      var rules = d.rules || [];
      if (!rules.length) { rulesWrap.innerHTML = ""; rulesEmpty.style.display = "block"; return; }
      rulesEmpty.style.display = "none";
      var h = "<table><thead><tr><th>ID</th><th>" + tt("lbl_rule_name") + "</th><th>" + tt("lbl_rule_content") + "</th><th>Status</th><th>" + tt("lbl_rule_order") + "</th><th>" + tt("actions") + "</th></tr></thead><tbody>";
      rules.forEach(function(r) {
        var badge = r.enabled
          ? "<span class='badge badge-green'>" + tt("enabled_badge") + "</span>"
          : "<span class='badge badge-gray'>" + tt("disabled_badge") + "</span>";
        var preview = r.content.length > 60 ? r.content.slice(0, 60) + "..." : r.content;
        h += "<tr>"
          + "<td><span class='code-text'>" + esc(r.id) + "</span></td>"
          + "<td>" + esc(r.name) + "</td>"
          + "<td class='stat-muted'>" + esc(preview) + "</td>"
          + "<td>" + badge + "</td>"
          + "<td class='stat-muted'>" + r.sortOrder + "</td>"
          + "<td><div class='actions'>"
          + "<button class='btn btn-sm btn-ghost' data-togglerule='" + esc(r.id) + "' data-enabled='" + (r.enabled ? "1" : "0") + "'>" + (r.enabled ? "Disable" : "Enable") + "</button>"
          + "<button class='btn btn-sm btn-ghost' data-editrule='" + esc(r.id) + "'>Edit</button>"
          + "<button class='btn btn-sm btn-danger' data-delrule='" + esc(r.id) + "'>" + tt("delete") + "</button>"
          + "</div></td></tr>";
      });
      h += "</tbody></table>";
      rulesWrap.innerHTML = h;
    });
  }

  ruleAddBtn.onclick = function() {
    editingRuleId = null;
    rfId.value = ""; rfName.value = ""; rfContent.value = ""; rfOrder.value = "0";
    rfId.disabled = false;
    ruleForm.style.display = "block";
    rfId.focus();
  };
  rfCancel.onclick = function() { ruleForm.style.display = "none"; };

  rfSave.onclick = function() {
    var id = rfId.value.trim();
    var content = rfContent.value.trim();
    if (!id || !content) return;
    rfSave.disabled = true;
    var payload = { id: id, name: rfName.value.trim() || id, content: content, sort_order: parseInt(rfOrder.value, 10) || 0, enabled: true };
    var method = editingRuleId ? "PATCH" : "POST";
    var path = editingRuleId ? "rules?id=" + encodeURIComponent(editingRuleId) : "rules";
    api(path, method, payload)
      .then(function() { ruleForm.style.display = "none"; showToast(tt("saved")); loadRules(); })
      .catch(function() { showToast(tt("failed")); })
      .finally(function() { rfSave.disabled = false; });
  };

  rulesWrap.addEventListener("click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.delrule) {
      if (!confirm(tt("confirm_delete_rule"))) return;
      api("rules?id=" + encodeURIComponent(btn.dataset.delrule), "DELETE").then(function() { loadRules(); showToast(tt("deleted")); });
    } else if (btn.dataset.togglerule) {
      var enabled = btn.dataset.enabled === "1";
      api("rules?id=" + encodeURIComponent(btn.dataset.togglerule), "PATCH", { enabled: !enabled }).then(function() { loadRules(); });
    } else if (btn.dataset.editrule) {
      var rid = btn.dataset.editrule;
      api("rules", "GET").then(function(d) {
        var r = (d.rules || []).find(function(x) { return x.id === rid; });
        if (!r) return;
        editingRuleId = rid;
        rfId.value = r.id; rfId.disabled = true;
        rfName.value = r.name || ""; rfContent.value = r.content || "";
        rfOrder.value = r.sortOrder || 0;
        ruleForm.style.display = "block";
      });
    }
  });

  // =====================================================
  // MEMORY TAB
  // =====================================================
  var memEnabled = document.getElementById("mem-enabled");
  var memProvider = document.getElementById("mem-provider");
  var memFallback = document.getElementById("mem-fallback");
  var memModel = document.getElementById("mem-model");
  var memCitations = document.getElementById("mem-citations");
  var memSrcMemory = document.getElementById("mem-src-memory");
  var memSrcSessions = document.getElementById("mem-src-sessions");
  var memChunkTokens = document.getElementById("mem-chunk-tokens");
  var memChunkOverlap = document.getElementById("mem-chunk-overlap");
  var memMaxResults = document.getElementById("mem-max-results");
  var memMinScore = document.getElementById("mem-min-score");
  var memHybrid = document.getElementById("mem-hybrid");
  var memSyncInterval = document.getElementById("mem-sync-interval");
  var memSaveBtn = document.getElementById("mem-save-btn");
  var memSyncBtn = document.getElementById("mem-sync-btn");
  var memSearchBtn = document.getElementById("mem-search-btn");
  var memSearchQuery = document.getElementById("mem-search-query");
  var memSearchResults = document.getElementById("mem-search-results");
  var PROVIDER_IDS = ["openai", "gemini", "voyage", "mistral", "ollama"];

  function loadMemoryConfig() {
    api("memory", "GET").then(function(d) {
      var c = d.config || {};
      memEnabled.checked = !!c.enabled;
      memProvider.value = c.provider || "auto";
      memFallback.value = c.fallback || "none";
      memModel.value = c.model || "";
      memCitations.value = c.citations || "auto";
      var sources = c.sources || ["memory"];
      memSrcMemory.checked = sources.indexOf("memory") >= 0;
      memSrcSessions.checked = sources.indexOf("sessions") >= 0;
      memChunkTokens.value = (c.chunking && c.chunking.tokens) || 400;
      memChunkOverlap.value = (c.chunking && c.chunking.overlap) || 80;
      var q = c.query || {};
      memMaxResults.value = q.maxResults || 6;
      memMinScore.value = q.minScore || 0.35;
      memHybrid.checked = q.hybrid ? !!q.hybrid.enabled : true;
      memSyncInterval.value = c.syncIntervalMinutes || 5;
      // Per-provider keys
      var p = c.providers || {};
      PROVIDER_IDS.forEach(function(pid) {
        var pk = document.getElementById("mem-pk-" + pid);
        var pu = document.getElementById("mem-pu-" + pid);
        if (pk) pk.value = (p[pid] && p[pid].apiKey) || "";
        if (pu) pu.value = (p[pid] && p[pid].baseUrl) || "";
      });

      var st = d.status;
      if (st) {
        var statusLine = st.searchMode + " (provider: " + st.provider + ", model: " + st.model + ")";
        if (st.fallback) statusLine += " [fallback from " + st.fallback.from + "]";
        document.getElementById("mem-status-text").textContent = st.enabled ? statusLine : "Disabled";
        document.getElementById("mem-files-chunks").textContent = st.files + " files / " + st.chunks + " chunks" + (st.dirty ? " (dirty)" : "");
        document.getElementById("mem-fts-status").textContent = st.fts ? (st.fts.available ? "Available" : "Unavailable" + (st.fts.error ? ": " + st.fts.error : "")) : "—";
        document.getElementById("mem-cache-status").textContent = st.cache ? st.cache.entries + " entries" : "—";
      } else {
        document.getElementById("mem-status-text").textContent = "Not initialized";
        document.getElementById("mem-files-chunks").textContent = "—";
        document.getElementById("mem-fts-status").textContent = "—";
        document.getElementById("mem-cache-status").textContent = "—";
      }
    }).catch(function() {});
  }

  memSaveBtn.onclick = function() {
    var sources = [];
    if (memSrcMemory.checked) sources.push("memory");
    if (memSrcSessions.checked) sources.push("sessions");
    var providers = {};
    PROVIDER_IDS.forEach(function(pid) {
      var pk = document.getElementById("mem-pk-" + pid);
      var pu = document.getElementById("mem-pu-" + pid);
      providers[pid] = { api_key: pk ? pk.value.trim() : "", base_url: pu ? pu.value.trim() : "" };
    });
    api("memory", "PATCH", {
      enabled: memEnabled.checked,
      provider: memProvider.value,
      fallback: memFallback.value,
      model: memModel.value.trim(),
      citations: memCitations.value,
      sources: sources,
      providers: providers,
      chunk_tokens: parseInt(memChunkTokens.value) || 400,
      chunk_overlap: parseInt(memChunkOverlap.value) || 80,
      max_results: parseInt(memMaxResults.value) || 6,
      min_score: parseFloat(memMinScore.value) || 0.35,
      hybrid_enabled: memHybrid.checked,
      sync_interval_minutes: parseInt(memSyncInterval.value) || 5,
    }).then(function() {
      showToast("Memory settings saved. Restart required for changes to take effect.");
    });
  };

  memSyncBtn.onclick = function() {
    memSyncBtn.disabled = true;
    memSyncBtn.textContent = "Syncing...";
    api("memory/sync", "POST").then(function(d) {
      var st = d.status;
      if (st) {
        document.getElementById("mem-files-chunks").textContent = st.files + " files / " + st.chunks + " chunks";
      }
      showToast("Memory sync complete");
    }).catch(function(e) {
      showToast("Sync failed: " + (e.message || e));
    }).finally(function() {
      memSyncBtn.disabled = false;
      memSyncBtn.textContent = "Sync Now";
    });
  };

  memSearchBtn.onclick = function() {
    var q = memSearchQuery.value.trim();
    if (!q) return;
    memSearchResults.textContent = "Searching...";
    api("memory/search?q=" + encodeURIComponent(q), "GET").then(function(d) {
      var results = d.results || [];
      if (results.length === 0) {
        memSearchResults.textContent = "No results found.";
        return;
      }
      memSearchResults.textContent = results.map(function(r, i) {
        return "[" + (i + 1) + "] " + r.path + " (L" + r.startLine + "-" + r.endLine + ", score=" + (r.score || 0).toFixed(3) + ", src=" + r.source + ")\\n" + (r.snippet || "").trim();
      }).join("\\n\\n");
    }).catch(function(e) {
      memSearchResults.textContent = "Error: " + (e.message || e);
    });
  };
  memSearchQuery.addEventListener("keydown", function(e) { if (e.key === "Enter") memSearchBtn.onclick(); });
  loadMemoryConfig();

  } // end initAdmin
})();
<\/script>
</body>
</html>`;
}
