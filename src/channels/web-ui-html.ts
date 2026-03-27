/** Chat UI HTML body markup. */

export function getChatBodyHtml(): string {
  return `
<div id="app">
  <div id="sidebar" class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-brand"><img src="/logo.png" alt="K"><span>Klaus</span></div>
      <button class="sidebar-toggle" id="sidebar-toggle" title="Toggle sidebar" data-i18n-title="toggle_sidebar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
      </button>
    </div>
    <div class="sidebar-nav">
      <button class="sidebar-nav-item" id="new-chat-btn">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        <span data-i18n="new_chat_nav">New chat</span>
      </button>
    </div>
    <div class="sidebar-section-label" data-i18n="recents">Recents</div>
    <div class="session-list" id="session-list"></div>
    <div class="sidebar-footer" style="position:relative">
      <div id="user-menu" class="user-menu"></div>
      <div id="user-menu-lang" class="user-menu-sub"></div>
      <div class="sidebar-user" id="sidebar-user">
        <div class="sidebar-avatar" id="sidebar-avatar">U</div>
        <div class="sidebar-user-info">
          <div class="sidebar-username" id="sidebar-username"></div>
        </div>
      </div>
    </div>
  </div>
  <div id="sidebar-overlay" class="sidebar-overlay"></div>
  <div class="main-content">
    <div id="header">
      <div class="header-left">
        <button class="menu-btn" id="menu-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
      <div class="header-right">
        <span id="status" data-i18n="connected">Connected</span>
      </div>
    </div>
    <div id="welcome">
      <div class="welcome-greeting" id="welcome-greeting"></div>
      <div class="welcome-sub" data-i18n="welcome_sub">How can I help you today?</div>
      <div class="welcome-chips" id="welcome-chips"></div>
    </div>
    <div id="messages"></div>
    <div id="input-wrapper">
      <div id="input-area">
        <div id="previews"></div>
        <div class="input-row">
          <button id="attach" title="Attach file" data-i18n-title="attach_file">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input type="file" id="file-input" multiple hidden accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.md,.json,.csv,.xml,.html,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.h,.yaml,.yml,.toml,.log,.sh,.bat">
          <textarea id="input" rows="1" placeholder="Send a message..." data-i18n-placeholder="placeholder" autocomplete="off"></textarea>
          <button id="send" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    </div>
    <!-- Admin view (hidden by default) -->
    <div id="admin-view" style="display:none">
      <div class="admin-inner">
        <button class="settings-back" id="admin-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          <span data-i18n="settings_back">Back</span>
        </button>
        <iframe id="admin-iframe" src="" style="width:100%;border:none;flex:1"></iframe>
      </div>
    </div>
    <!-- Settings view (hidden by default) — tabbed layout -->
    <div id="settings-view" style="display:none">
      <div class="settings-inner">
        <div class="settings-sidebar">
          <button class="settings-back" id="settings-back" style="margin-bottom:16px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span data-i18n="settings_back">Back</span>
          </button>
          <div class="settings-sidebar-title" data-i18n="settings_title">Settings</div>
          <div class="settings-sidebar-nav">
            <button class="settings-nav-item active" data-stab="profile" data-i18n="settings_profile">Profile</button>
            <button class="settings-nav-item" data-stab="channels" data-i18n="settings_channels">Channels</button>
            <button class="settings-nav-item" data-stab="mcp" data-i18n="settings_mcp">MCP</button>
            <button class="settings-nav-item" data-stab="cron" data-i18n="settings_cron">Tasks</button>
          </div>
        </div>
        <div class="settings-content">

          <!-- Profile tab (includes appearance) -->
          <div class="settings-tab-panel active" id="stab-profile">
            <div class="settings-section">
              <div class="settings-section-title" data-i18n="settings_profile">Profile</div>
              <div class="settings-profile-header">
                <div class="settings-avatar" id="settings-avatar">
                  <div class="settings-avatar-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
                  <input type="file" id="settings-avatar-input" accept="image/jpeg,image/png,image/webp" style="display:none">
                </div>
                <div class="settings-profile-info">
                  <div class="settings-profile-name" id="settings-profile-name"></div>
                  <div class="settings-profile-email" id="settings-profile-email"></div>
                </div>
              </div>
              <div class="settings-field">
                <label class="settings-field-label" data-i18n="settings_display_name">Display name</label>
                <input class="settings-field-input" type="text" id="settings-input-name" maxlength="50">
              </div>
              <button class="settings-btn-save" id="settings-btn-save" data-i18n="settings_save">Save</button>
              <span class="settings-save-status" id="settings-save-status"></span>
            </div>

            <div class="settings-section">
              <div class="settings-section-title" data-i18n="settings_appearance">Appearance</div>
              <div class="settings-field">
                <label class="settings-field-label" data-i18n="settings_color_mode">Color mode</label>
                <div class="settings-theme-options" id="settings-theme-options">
                  <div class="settings-theme-card" data-theme="light">
                    <div class="settings-theme-preview settings-theme-preview-light"></div>
                    <div class="settings-theme-label" data-i18n="settings_theme_light">Light</div>
                  </div>
                  <div class="settings-theme-card" data-theme="dark">
                    <div class="settings-theme-preview settings-theme-preview-dark"></div>
                    <div class="settings-theme-label" data-i18n="settings_theme_dark">Dark</div>
                  </div>
                  <div class="settings-theme-card active" data-theme="auto">
                    <div class="settings-theme-preview settings-theme-preview-auto"></div>
                    <div class="settings-theme-label" data-i18n="settings_theme_auto">System</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Channels tab -->
          <div class="settings-tab-panel" id="stab-channels">
            <div class="settings-section">
              <div class="settings-section-title" data-i18n="settings_channels">Channels</div>
              <p style="color:var(--fg-tertiary);font-size:14px;margin-bottom:20px" data-i18n="settings_channels_desc">Connect messaging platforms so users can chat with Klaus directly from their IM apps.</p>

              <!-- Feishu card -->
              <div style="border:1px solid var(--border);border-radius:12px;padding:20px" id="s-ch-feishu-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                  <div style="display:flex;align-items:center;gap:12px">
                    <img src="/feishu.png" alt="Feishu" width="36" height="36" style="border-radius:8px">
                    <div>
                      <div style="font-weight:600;font-size:15px" data-i18n="settings_ch_feishu">Feishu / Lark</div>
                      <div style="font-size:12px;color:var(--fg-tertiary)" data-i18n="settings_ch_feishu_desc">Connect to Feishu bot for team messaging</div>
                    </div>
                  </div>
                  <span class="s-badge" id="s-ch-feishu-status"></span>
                </div>

                <!-- Connected state -->
                <div id="s-ch-feishu-connected" style="display:none;margin-top:16px">
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                      <div style="font-size:12px;color:var(--fg-tertiary)">App ID</div>
                      <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-feishu-appid-display"></div>
                    </div>
                    <div>
                      <div style="font-size:12px;color:var(--fg-tertiary)" data-i18n="settings_ch_bot">Bot</div>
                      <div style="font-size:14px;font-weight:500" id="s-ch-feishu-bot-display">-</div>
                    </div>
                    <button class="s-btn s-btn-danger" id="s-ch-feishu-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                  </div>
                  <div style="margin-top:12px;padding:12px 16px;background:var(--bg-surface);border-radius:8px;font-size:13px;color:var(--fg-tertiary)">
                    <div style="font-weight:500;color:var(--fg);margin-bottom:6px" data-i18n="settings_ch_feishu_after_connect">After connecting:</div>
                    <div data-i18n="settings_ch_feishu_step_event">5. Configure event subscription: Events &amp; Callbacks &rarr; Long Connection &rarr; Add &quot;Receive Message&quot;</div>
                    <div style="margin-top:4px" data-i18n="settings_ch_feishu_step_callback">6. Add callback: Callback Config &rarr; Long Connection &rarr; Add &quot;Card Interaction&quot;</div>
                    <div style="margin-top:4px" data-i18n="settings_ch_feishu_step_publish">7. Create version and publish the app</div>
                    <a href="https://open.feishu.cn/app" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;color:var(--accent);text-decoration:underline;font-size:13px" data-i18n="settings_ch_feishu_open_console">Open Feishu Console</a>
                  </div>
                </div>

                <!-- Config form with step-by-step guide -->
                <div id="s-ch-feishu-form" style="display:none;margin-top:16px">
                  <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                    <div style="font-weight:600;color:var(--fg);margin-bottom:8px" data-i18n="settings_ch_feishu_guide_title">Setup Steps</div>

                    <div style="margin-bottom:6px">
                      <span style="font-weight:500;color:var(--fg)">1.</span>
                      <span data-i18n="settings_ch_feishu_step1">Create app on Feishu Open Platform</span>
                      <a href="https://open.feishu.cn/app" target="_blank" rel="noopener" style="margin-left:6px;color:var(--accent);text-decoration:underline" data-i18n="settings_ch_feishu_step1_link">Create App &rarr;</a>
                    </div>

                    <div style="margin-bottom:6px">
                      <span style="font-weight:500;color:var(--fg)">2.</span>
                      <span data-i18n="settings_ch_feishu_step2">In app details, click &quot;Add Capability&quot; &rarr; add &quot;Bot&quot;</span>
                    </div>

                    <div style="margin-bottom:6px">
                      <span style="font-weight:500;color:var(--fg)">3.</span>
                      <span data-i18n="settings_ch_feishu_step3">Go to &quot;Permissions&quot; &rarr; &quot;Batch Import&quot;, paste the permission JSON below, then click &quot;Apply&quot;</span>
                      <button class="s-btn s-btn-ghost" style="margin-left:6px;font-size:12px;padding:2px 8px" id="s-ch-feishu-copy-perms" data-i18n="settings_ch_feishu_copy_perms">Copy Permissions</button>
                    </div>

                    <div style="margin-bottom:6px">
                      <span style="font-weight:500;color:var(--fg)">4.</span>
                      <span data-i18n="settings_ch_feishu_step4">Go to &quot;Credentials &amp; Basic Info&quot;, copy App ID and App Secret below</span>
                    </div>
                  </div>

                  <div style="display:flex;flex-direction:column;gap:12px">
                    <div><label class="settings-field-label">App ID <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-feishu-appid" style="max-width:100%" placeholder="cli_xxxxxxxxxxxxxxxx"></div>
                    <div><label class="settings-field-label">App Secret <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-feishu-secret" type="password" style="max-width:100%" placeholder="Enter App Secret"></div>
                  </div>
                  <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                    <button class="s-btn s-btn-ghost" id="s-ch-feishu-cancel-btn" data-i18n="settings_cancel">Cancel</button>
                    <button class="s-btn s-btn-primary" id="s-ch-feishu-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                  </div>
                </div>

                <!-- Setup button -->
                <div id="s-ch-feishu-setup" style="margin-top:16px">
                  <button class="s-btn s-btn-primary" id="s-ch-feishu-setup-btn" data-i18n="settings_ch_setup">Configure</button>
                </div>
              </div>
            </div>

              <!-- DingTalk card -->
              <div style="border:1px solid var(--border);border-radius:12px;padding:20px;margin-top:16px" id="s-ch-dingtalk-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                  <div style="display:flex;align-items:center;gap:12px">
                    <img src="/dingtalk.png" alt="DingTalk" width="36" height="36" style="border-radius:8px">
                    <div>
                      <div style="font-weight:600;font-size:15px" data-i18n="settings_ch_dingtalk">DingTalk</div>
                      <div style="font-size:12px;color:var(--fg-tertiary)" data-i18n="settings_ch_dingtalk_desc">Connect to DingTalk bot for team messaging</div>
                    </div>
                  </div>
                  <span class="s-badge" id="s-ch-dingtalk-status"></span>
                </div>
                <div id="s-ch-dingtalk-connected" style="display:none;margin-top:16px">
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                      <div style="font-size:12px;color:var(--fg-tertiary)">Client ID</div>
                      <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-dingtalk-clientid-display"></div>
                    </div>
                    <button class="s-btn s-btn-danger" id="s-ch-dingtalk-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                  </div>
                </div>
                <div id="s-ch-dingtalk-form" style="display:none;margin-top:16px">
                  <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                    <div style="font-weight:600;color:var(--fg);margin-bottom:8px" data-i18n="settings_ch_dingtalk_guide_title">Setup Steps</div>
                    <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">1.</span> <span data-i18n="settings_ch_dingtalk_step1">Create app on DingTalk Open Platform</span> <a href="https://open-dev.dingtalk.com/fe/app" target="_blank" rel="noopener" style="margin-left:6px;color:var(--accent);text-decoration:underline" data-i18n="settings_ch_dingtalk_step1_link">Create App</a></div>
                    <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">2.</span> <span data-i18n="settings_ch_dingtalk_step2">Add "Bot" capability, enable Stream mode</span></div>
                    <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">3.</span> <span data-i18n="settings_ch_dingtalk_step3">Copy Client ID (AppKey) and Client Secret (AppSecret) below</span></div>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:12px">
                    <div><label class="settings-field-label">Client ID (AppKey) <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-dingtalk-clientid" style="max-width:100%" placeholder="dingxxxxxxxx"></div>
                    <div><label class="settings-field-label">Client Secret (AppSecret) <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-dingtalk-secret" type="password" style="max-width:100%" placeholder="Enter Client Secret"></div>
                  </div>
                  <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                    <button class="s-btn s-btn-ghost" id="s-ch-dingtalk-cancel-btn" data-i18n="settings_cancel">Cancel</button>
                    <button class="s-btn s-btn-primary" id="s-ch-dingtalk-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                  </div>
                </div>
                <div id="s-ch-dingtalk-setup" style="margin-top:16px">
                  <button class="s-btn s-btn-primary" id="s-ch-dingtalk-setup-btn" data-i18n="settings_ch_setup">Configure</button>
                </div>
              </div>

              <!-- WeChat card -->
              <div style="border:1px solid var(--border);border-radius:12px;padding:20px;margin-top:16px" id="s-ch-wechat-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                  <div style="display:flex;align-items:center;gap:12px">
                    <img src="/wechat.png" alt="WeChat" width="36" height="36" style="border-radius:8px">
                    <div>
                      <div style="font-weight:600;font-size:15px" data-i18n="settings_ch_wechat">WeChat</div>
                      <div style="font-size:12px;color:var(--fg-tertiary)" data-i18n="settings_ch_wechat_desc">Scan QR code to connect WeChat bot</div>
                    </div>
                  </div>
                  <span class="s-badge" id="s-ch-wechat-status"></span>
                </div>
                <div id="s-ch-wechat-connected" style="display:none;margin-top:16px">
                  <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                      <div style="font-size:12px;color:var(--fg-tertiary)">Account ID</div>
                      <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-wechat-account-display"></div>
                    </div>
                    <button class="s-btn s-btn-danger" id="s-ch-wechat-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                  </div>
                </div>
                <div id="s-ch-wechat-qr" style="display:none;margin-top:16px;text-align:center">
                  <div style="font-size:13px;color:var(--fg-tertiary);margin-bottom:12px" data-i18n="settings_ch_wechat_scan_hint">Open WeChat and scan the QR code below</div>
                  <iframe id="s-ch-wechat-qr-frame" style="width:280px;height:360px;border:1px solid var(--border);border-radius:8px;background:#fff" sandbox="allow-same-origin"></iframe>
                  <div style="margin-top:8px;font-size:12px;color:var(--fg-tertiary)" id="s-ch-wechat-qr-status" data-i18n="settings_ch_wechat_waiting">Waiting for scan...</div>
                </div>
                <div id="s-ch-wechat-setup" style="margin-top:16px">
                  <button class="s-btn s-btn-primary" id="s-ch-wechat-login-btn" data-i18n="settings_ch_wechat_login">Login with QR Code</button>
                </div>
              </div>
            </div>
          </div>

          <!-- MCP tab -->
          <div class="settings-tab-panel" id="stab-mcp">
            <div class="settings-section" id="settings-mcp-section">
              <div class="settings-section-header">
                <div class="settings-section-header-title" data-i18n="settings_mcp">MCP Servers</div>
                <button class="s-btn s-btn-primary" id="s-mcp-add-btn" data-i18n="settings_mcp_add">+ Add Server</button>
              </div>
              <div id="s-mcp-form" class="s-form" style="display:none">
                <div class="s-form-grid">
                  <div><label data-i18n="settings_mcp_id">ID</label><input id="s-mcpf-id" class="s-form-input" placeholder="e.g. filesystem"></div>
                  <div><label data-i18n="settings_mcp_name">Name</label><input id="s-mcpf-name" class="s-form-input" placeholder="Display name"></div>
                  <div><label data-i18n="settings_mcp_type">Transport</label>
                    <select id="s-mcpf-type" class="s-form-select"><option value="stdio">stdio</option><option value="sse">sse</option></select>
                  </div>
                  <div id="s-mcpf-stdio-fields">
                    <label data-i18n="settings_mcp_command">Command</label><input id="s-mcpf-command" class="s-form-input" placeholder="e.g. npx -y @modelcontextprotocol/server-filesystem">
                    <label data-i18n="settings_mcp_args" style="margin-top:8px">Args (comma-separated)</label><input id="s-mcpf-args" class="s-form-input" placeholder="e.g. /tmp,/home">
                  </div>
                  <div id="s-mcpf-sse-fields" style="display:none">
                    <label data-i18n="settings_mcp_url">URL</label><input id="s-mcpf-url" class="s-form-input" placeholder="http://localhost:3001/sse">
                  </div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                  <button class="s-btn s-btn-ghost" id="s-mcpf-cancel" data-i18n="settings_cancel">Cancel</button>
                  <button class="s-btn s-btn-primary" id="s-mcpf-save" data-i18n="settings_save">Save</button>
                </div>
              </div>
              <div id="s-mcp-wrap"></div>
              <div id="s-mcp-empty" class="s-empty" style="display:none" data-i18n="settings_mcp_empty">No MCP servers configured.</div>
            </div>
          </div>

          <!-- Cron tab -->
          <div class="settings-tab-panel" id="stab-cron">
            <div class="settings-section" id="settings-cron-section">
              <div class="settings-section-header">
                <div class="settings-section-header-title" data-i18n="settings_cron">Scheduled Tasks</div>
                <button class="s-btn s-btn-primary" id="s-cron-add-btn" data-i18n="settings_cron_add">+ Add Task</button>
              </div>
              <div id="s-cron-scheduler-bar" class="s-scheduler-bar"></div>
              <div id="s-cron-form" class="s-form" style="display:none">
                <div class="s-form-grid">
                  <div><label data-i18n="settings_cron_task_id">Task ID</label><input id="s-cf-id" class="s-form-input" placeholder="e.g. daily-summary"></div>
                  <div><label data-i18n="settings_cron_task_name">Name</label><input id="s-cf-name" class="s-form-input" placeholder="Optional display name"></div>
                  <div><label data-i18n="settings_cron_schedule">Schedule</label><input id="s-cf-schedule" class="s-form-input" placeholder="e.g. 0 9 * * *"></div>
                  <div class="s-form-full"><label data-i18n="settings_cron_prompt">Prompt</label><textarea id="s-cf-prompt" class="s-form-textarea" rows="3" placeholder="Prompt text"></textarea></div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                  <button class="s-btn s-btn-ghost" id="s-cf-cancel" data-i18n="settings_cancel">Cancel</button>
                  <button class="s-btn s-btn-primary" id="s-cf-save" data-i18n="settings_save">Save</button>
                </div>
              </div>
              <div id="s-cron-wrap"></div>
              <div id="s-cron-empty" class="s-empty" style="display:none" data-i18n="settings_cron_empty">No scheduled tasks.</div>
            </div>
          </div>

        </div>
      </div>
    </div>
    <div class="s-toast" id="s-toast"></div>
  </div>
</div>
`;
}
