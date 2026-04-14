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
        <span id="collapse-stats" class="collapse-stats" style="display:none"></span>
        <span id="status" data-i18n="connected">Connected</span>
      </div>
    </div>
    <div id="welcome">
      <div class="welcome-greeting" id="welcome-greeting"></div>
      <div class="welcome-sub" data-i18n="welcome_sub">How can I help you today?</div>
      <div class="welcome-chips" id="welcome-chips"></div>
    </div>
    <div id="messages"></div>
    <div id="agent-panel" style="display:none">
      <div id="agent-panel-header">
        <span id="agent-panel-toggle">▼</span>
        <span id="agent-panel-title"></span>
        <span id="agent-panel-count"></span>
        <button id="agent-panel-close" title="Close">×</button>
      </div>
      <div id="agent-panel-body"></div>
    </div>
    <div id="input-wrapper">
      <div id="slash-menu" class="slash-menu hidden"></div>
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
          <button class="settings-back" id="settings-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span data-i18n="settings_back">Back</span>
          </button>
          <div class="settings-sidebar-title" data-i18n="settings_title">Settings</div>
          <div class="settings-sidebar-nav">
            <button class="settings-nav-item active" data-stab="profile" data-i18n="settings_profile">Profile</button>
            <button class="settings-nav-item" data-stab="channels" data-i18n="settings_channels">Channels</button>
            <button class="settings-nav-item" data-stab="skills" data-i18n="settings_skills">Skills</button>
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

            <div class="settings-section">
              <div class="settings-section-title" data-i18n="settings_permission_mode">Permission Mode</div>
              <div class="settings-field">
                <label class="settings-field-label" data-i18n="settings_permission_mode_desc">Choose when tool execution requires your approval</label>
                <div class="settings-permission-options" id="settings-permission-options">
                  <div class="settings-perm-card" data-perm="default">
                    <div class="settings-perm-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    </div>
                    <div class="settings-perm-info">
                      <div class="settings-perm-label" data-i18n="settings_perm_default">Default</div>
                      <div class="settings-perm-desc" data-i18n="settings_perm_default_desc">Ask permission for potentially risky operations</div>
                    </div>
                  </div>
                  <div class="settings-perm-card" data-perm="plan">
                    <div class="settings-perm-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    </div>
                    <div class="settings-perm-info">
                      <div class="settings-perm-label" data-i18n="settings_perm_plan">Plan Mode</div>
                      <div class="settings-perm-desc" data-i18n="settings_perm_plan_desc">Review and approve plans before any execution</div>
                    </div>
                  </div>
                  <div class="settings-perm-card" data-perm="acceptEdits">
                    <div class="settings-perm-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </div>
                    <div class="settings-perm-info">
                      <div class="settings-perm-label" data-i18n="settings_perm_accept_edits">Accept Edits</div>
                      <div class="settings-perm-desc" data-i18n="settings_perm_accept_edits_desc">Auto-approve file edits, ask for other operations</div>
                    </div>
                  </div>
                  <div class="settings-perm-card" data-perm="bypassPermissions">
                    <div class="settings-perm-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    </div>
                    <div class="settings-perm-info">
                      <div class="settings-perm-label" data-i18n="settings_perm_bypass">YOLO Mode</div>
                      <div class="settings-perm-desc" data-i18n="settings_perm_bypass_desc">Auto-approve all tools, no approval required</div>
                    </div>
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

              <div class="ch-grid">
                <!-- WeChat -->
                <div class="ch-card" id="s-ch-wechat-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/wechat-icon.png" alt="WeChat" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_wechat">WeChat</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-wechat-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_wechat_desc">Scan QR code to connect WeChat bot</div>
                </div>

                <!-- WeCom -->
                <div class="ch-card" id="s-ch-wecom-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/wecom-icon.png" alt="WeCom" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_wecom">WeCom</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-wecom-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_wecom_desc">Connect to WeCom smart bot</div>
                </div>

                <!-- QQ -->
                <div class="ch-card" id="s-ch-qq-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/qq-icon.png" alt="QQ" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_qq">QQ</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-qq-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_qq_desc">Connect to QQ via official QQ Bot API</div>
                </div>

                <!-- Feishu -->
                <div class="ch-card" id="s-ch-feishu-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/feishu.png" alt="Feishu" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_feishu">Feishu / Lark</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-feishu-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_feishu_desc">Connect to Feishu bot for team messaging</div>
                </div>

                <!-- DingTalk -->
                <div class="ch-card" id="s-ch-dingtalk-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/dingtalk.png" alt="DingTalk" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_dingtalk">DingTalk</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-dingtalk-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_dingtalk_desc">Connect to DingTalk bot for team messaging</div>
                </div>

                <!-- Telegram -->
                <div class="ch-card" id="s-ch-telegram-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/telegram-icon.png" alt="Telegram" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_telegram">Telegram</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-telegram-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_telegram_desc">Connect Telegram Bot via Bot API</div>
                </div>

                <!-- iMessage -->
                <div class="ch-card" id="s-ch-imessage-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/imessage-icon.png" alt="iMessage" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_imessage">iMessage</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-imessage-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_imessage_desc">macOS iMessage bridge via imsg CLI</div>
                </div>

                <!-- WhatsApp -->
                <div class="ch-card" id="s-ch-whatsapp-card">
                  <div class="ch-card-head">
                    <div style="display:flex;align-items:center;gap:12px">
                      <img src="/whatsapp-icon.png" alt="WhatsApp" width="42" height="42" style="border-radius:10px">
                      <div style="font-weight:600;font-size:16px" data-i18n="settings_ch_whatsapp">WhatsApp</div>
                    </div>
                    <button class="ch-card-btn" id="s-ch-whatsapp-cfg-btn" data-i18n="settings_ch_setup">Configure</button>
                  </div>
                  <div class="ch-card-desc" data-i18n="settings_ch_whatsapp_desc">WhatsApp via Baileys (QR code login)</div>
                </div>
              </div>
            </div>

            <!-- Channel config modal -->
            <div class="ch-modal-overlay" id="ch-modal-overlay">
              <div class="ch-modal" role="dialog" aria-modal="true">
                <div class="ch-modal-header">
                  <div style="display:flex;align-items:center;gap:12px">
                    <img id="ch-modal-icon" width="36" height="36" style="border-radius:8px" alt="">
                    <div>
                      <div style="font-weight:600;font-size:17px" id="ch-modal-title"></div>
                      <div style="font-size:13px;color:var(--fg-tertiary)" id="ch-modal-desc"></div>
                    </div>
                  </div>
                  <button class="ch-modal-close" id="ch-modal-close">&times;</button>
                </div>
                <div class="ch-modal-body" id="ch-modal-body">
                  <!-- Feishu content -->
                  <div id="s-ch-feishu-modal-content" style="display:none">
                    <div id="s-ch-feishu-connected" style="display:none">
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
                    <div id="s-ch-feishu-form">
                      <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                        <div style="font-weight:600;color:var(--fg);margin-bottom:8px" data-i18n="settings_ch_feishu_guide_title">Setup Steps</div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">1.</span> <span data-i18n="settings_ch_feishu_step1">Create app on Feishu Open Platform</span> <a href="https://open.feishu.cn/app" target="_blank" rel="noopener" style="margin-left:6px;color:var(--accent);text-decoration:underline" data-i18n="settings_ch_feishu_step1_link">Create App &rarr;</a></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">2.</span> <span data-i18n="settings_ch_feishu_step2">In app details, click &quot;Add Capability&quot; &rarr; add &quot;Bot&quot;</span></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">3.</span> <span data-i18n="settings_ch_feishu_step3">Go to &quot;Permissions&quot; &rarr; &quot;Batch Import&quot;, paste the permission JSON below, then click &quot;Apply&quot;</span> <button class="s-btn s-btn-ghost" style="margin-left:6px;font-size:12px;padding:2px 8px" id="s-ch-feishu-copy-perms" data-i18n="settings_ch_feishu_copy_perms">Copy Permissions</button></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">4.</span> <span data-i18n="settings_ch_feishu_step4">Go to &quot;Credentials &amp; Basic Info&quot;, copy App ID and App Secret below</span></div>
                      </div>
                      <div style="display:flex;flex-direction:column;gap:12px">
                        <div><label class="settings-field-label">App ID <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-feishu-appid" style="max-width:100%" placeholder="cli_xxxxxxxxxxxxxxxx"></div>
                        <div><label class="settings-field-label">App Secret <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-feishu-secret" type="password" style="max-width:100%" placeholder="Enter App Secret"></div>
                      </div>
                      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                        <button class="s-btn s-btn-primary" id="s-ch-feishu-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                      </div>
                    </div>
                  </div>

                  <!-- DingTalk content -->
                  <div id="s-ch-dingtalk-modal-content" style="display:none">
                    <div id="s-ch-dingtalk-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)">Client ID</div>
                          <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-dingtalk-clientid-display"></div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-dingtalk-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                    </div>
                    <div id="s-ch-dingtalk-form">
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
                        <button class="s-btn s-btn-primary" id="s-ch-dingtalk-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                      </div>
                    </div>
                  </div>

                  <!-- WeChat content -->
                  <div id="s-ch-wechat-modal-content" style="display:none">
                    <div id="s-ch-wechat-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)">Account ID</div>
                          <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-wechat-account-display"></div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-wechat-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                    </div>
                    <div id="s-ch-wechat-qr" style="display:none;text-align:center">
                      <div style="font-size:13px;color:var(--fg-tertiary);margin-bottom:12px" data-i18n="settings_ch_wechat_scan_hint">Open WeChat and scan the QR code below</div>
                      <img id="s-ch-wechat-qr-img" style="max-width:280px;border-radius:8px" alt="QR Code">
                      <div style="margin-top:8px;font-size:12px;color:var(--fg-tertiary)" id="s-ch-wechat-qr-status" data-i18n="settings_ch_wechat_waiting">Waiting for scan...</div>
                    </div>
                    <div id="s-ch-wechat-setup" style="text-align:center;padding:20px 0">
                      <div style="font-size:13px;color:var(--fg-tertiary)" data-i18n="settings_ch_wechat_waiting">Waiting for scan...</div>
                      <button class="s-btn s-btn-primary" id="s-ch-wechat-login-btn" style="display:none">Login</button>
                    </div>
                  </div>

                  <!-- WeCom content -->
                  <div id="s-ch-wecom-modal-content" style="display:none">
                    <div id="s-ch-wecom-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)">Bot ID</div>
                          <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-wecom-botid-display"></div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-wecom-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                    </div>
                    <div id="s-ch-wecom-form">
                      <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                        <div style="font-weight:600;color:var(--fg);margin-bottom:8px" data-i18n="settings_ch_wecom_guide_title">Setup Steps</div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">1.</span> <span data-i18n="settings_ch_wecom_step1">Admin Console &rarr; &ldquo;Admin Tools&rdquo; (left sidebar, bottom)</span> <a href="https://work.weixin.qq.com/wework_admin/frame#manageTools" target="_blank" rel="noopener" style="margin-left:6px;color:var(--accent);text-decoration:underline" data-i18n="settings_ch_wecom_step1_link">Open Console</a></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">2.</span> <span data-i18n="settings_ch_wecom_step2">Click &ldquo;Smart Bot&rdquo; &rarr; &ldquo;Create Bot&rdquo; &rarr; &ldquo;Manual Create&rdquo;</span></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">3.</span> <span data-i18n="settings_ch_wecom_step3">At the bottom, click &ldquo;API Mode&rdquo; &rarr; choose &ldquo;Long Connection&rdquo; &rarr; Save</span></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">4.</span> <span data-i18n="settings_ch_wecom_step4">Copy Bot ID and Secret below</span></div>
                      </div>
                      <div style="display:flex;flex-direction:column;gap:12px">
                        <div><label class="settings-field-label">Bot ID <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-wecom-botid" style="max-width:100%" placeholder="Enter Bot ID"></div>
                        <div><label class="settings-field-label">Secret <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-wecom-secret" type="password" style="max-width:100%" placeholder="Enter Secret"></div>
                      </div>
                      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                        <button class="s-btn s-btn-primary" id="s-ch-wecom-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                      </div>
                    </div>
                  </div>

                  <!-- QQ content -->
                  <div id="s-ch-qq-modal-content" style="display:none">
                    <div id="s-ch-qq-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)">App ID</div>
                          <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-qq-appid-display"></div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-qq-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                    </div>
                    <div id="s-ch-qq-form">
                      <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                        <div style="font-weight:600;color:var(--fg);margin-bottom:8px" data-i18n="settings_ch_qq_guide_title">Setup Steps</div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">1.</span> <span data-i18n="settings_ch_qq_step1">Create a bot on QQ Open Platform</span> <a href="https://q.qq.com/" target="_blank" rel="noopener" style="margin-left:6px;color:var(--accent);text-decoration:underline" data-i18n="settings_ch_qq_step1_link">Open Platform</a></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">2.</span> <span data-i18n="settings_ch_qq_step2">Find the bot's App ID and App Secret in the bot settings page</span></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">3.</span> <span data-i18n="settings_ch_qq_step3">Copy App ID and App Secret below</span></div>
                      </div>
                      <div style="display:flex;flex-direction:column;gap:12px">
                        <div><label class="settings-field-label">App ID <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-qq-appid" style="max-width:100%" placeholder="102xxxxxx"></div>
                        <div><label class="settings-field-label">App Secret <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-qq-secret" type="password" style="max-width:100%" placeholder="Enter App Secret"></div>
                      </div>
                      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                        <button class="s-btn s-btn-primary" id="s-ch-qq-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                      </div>
                    </div>
                  </div>

                  <!-- Telegram content -->
                  <div id="s-ch-telegram-modal-content" style="display:none">
                    <div id="s-ch-telegram-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)">Bot</div>
                          <div style="font-family:var(--font-mono);font-size:13px" id="s-ch-telegram-bot-display"></div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-telegram-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                    </div>
                    <div id="s-ch-telegram-form">
                      <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                        <div style="font-weight:600;color:var(--fg);margin-bottom:8px" data-i18n="settings_ch_telegram_guide_title">Setup Steps</div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">1.</span> <span data-i18n="settings_ch_telegram_step1">Open Telegram, search @BotFather and start a chat</span> <a href="https://t.me/BotFather" target="_blank" rel="noopener" style="margin-left:6px;color:var(--accent);text-decoration:underline" data-i18n="settings_ch_telegram_step1_link">Open @BotFather</a></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">2.</span> <span data-i18n="settings_ch_telegram_step2">Send /newbot, set a name and username for your bot</span></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">3.</span> <span data-i18n="settings_ch_telegram_step3">BotFather will reply with a Bot Token (format: 123456:ABC-DEF...)</span></div>
                        <div style="margin-bottom:6px"><span style="font-weight:500;color:var(--fg)">4.</span> <span data-i18n="settings_ch_telegram_step4">Copy the Bot Token and paste it below</span></div>
                      </div>
                      <div style="display:flex;flex-direction:column;gap:12px">
                        <div><label class="settings-field-label">Bot Token <span style="color:#dc2626">*</span></label><input class="settings-field-input" id="s-ch-telegram-token" type="password" style="max-width:100%" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"></div>
                      </div>
                      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                        <button class="s-btn s-btn-primary" id="s-ch-telegram-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                      </div>
                    </div>
                  </div>

                  <!-- iMessage content -->
                  <div id="s-ch-imessage-modal-content" style="display:none">
                    <div id="s-ch-imessage-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)" data-i18n="settings_ch_connected">Connected</div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-imessage-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                      <div style="margin-top:12px;font-size:13px;color:var(--fg-tertiary);line-height:1.7" data-i18n="settings_ch_imessage_usage">iMessage bridge is running. Anyone who sends you an iMessage will get a reply from Klaus. You can view these conversations in the session list on the left.</div>
                    </div>
                    <div id="s-ch-imessage-form">
                      <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.7;margin-bottom:20px">
                        <div data-i18n="settings_ch_imessage_info">Click Connect to auto-install imsg and set up iMessage bridge. You may need to grant Full Disk Access permission when prompted.</div>
                      </div>
                      <div id="s-ch-imessage-permission-hint" style="display:none;background:var(--bg-warning,#fef3cd);border:1px solid var(--border-warning,#ffc107);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--fg)">
                        <div style="font-weight:600;margin-bottom:4px" data-i18n="settings_ch_imessage_perm_title">Grant Full Disk Access</div>
                        <div data-i18n="settings_ch_imessage_perm_desc">Open System Settings &rarr; Privacy &amp; Security &rarr; Full Disk Access, and enable your terminal app (Terminal / iTerm / Warp). Then click Connect again.</div>
                      </div>
                      <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button class="s-btn s-btn-primary" id="s-ch-imessage-connect-btn" data-i18n="settings_ch_connect">Connect</button>
                      </div>
                    </div>
                  </div>

                  <!-- WhatsApp content -->
                  <div id="s-ch-whatsapp-modal-content" style="display:none">
                    <div id="s-ch-whatsapp-connected" style="display:none">
                      <div style="border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <div style="font-size:12px;color:var(--fg-tertiary)" data-i18n="settings_ch_connected">Connected</div>
                        </div>
                        <button class="s-btn s-btn-danger" id="s-ch-whatsapp-disconnect-btn" data-i18n="settings_ch_disconnect">Disconnect</button>
                      </div>
                    </div>
                    <div id="s-ch-whatsapp-qr" style="display:none;text-align:center">
                      <div style="font-size:13px;color:var(--fg-tertiary);margin-bottom:12px" data-i18n="settings_ch_whatsapp_scan_hint">Open WhatsApp &rarr; Linked Devices &rarr; Link a Device &rarr; Scan</div>
                      <img id="s-ch-whatsapp-qr-img" style="max-width:280px;border-radius:8px" alt="QR Code">
                      <div style="margin-top:8px;font-size:12px;color:var(--fg-tertiary)" id="s-ch-whatsapp-qr-status" data-i18n="settings_ch_whatsapp_waiting">Waiting for scan...</div>
                    </div>
                    <div id="s-ch-whatsapp-setup" style="text-align:center;padding:20px 0">
                      <div style="font-size:13px;color:var(--fg-tertiary);margin-bottom:12px" data-i18n="settings_ch_whatsapp_loading">Loading...</div>
                      <button class="s-btn s-btn-primary" id="s-ch-whatsapp-connect-btn" style="display:none">Connect</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- MCP tab -->
          <div class="settings-tab-panel" id="stab-mcp">
            <div class="settings-section" id="settings-mcp-section">
              <div class="settings-section-header">
                <div class="settings-section-header-title" data-i18n="settings_mcp">MCP Servers</div>
                <div style="position:relative">
                  <button class="s-btn s-btn-primary" id="s-mcp-add-btn" data-i18n="settings_mcp_add">+ Add</button>
                  <div id="s-mcp-add-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:var(--s-bg,#fff);border:1px solid var(--s-border,#e2e8f0);border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.1);z-index:10;min-width:220px;padding:8px">
                    <button class="s-mcp-menu-item" id="s-mcp-menu-manual" style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;border:none;background:none;cursor:pointer;border-radius:8px;font-size:15px;font-family:inherit;color:inherit;text-align:left">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span data-i18n="settings_mcp_manual">Manual Config</span>
                    </button>
                    <button class="s-mcp-menu-item" id="s-mcp-menu-json" style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;border:none;background:none;cursor:pointer;border-radius:8px;font-size:15px;font-family:inherit;color:inherit;text-align:left">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                      <span data-i18n="settings_mcp_json">Paste JSON Config</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Manual Config Form -->
              <div id="s-mcp-manual-form" class="s-form" style="display:none">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
                  <div>
                    <div style="font-weight:600;font-size:16px" data-i18n="settings_mcp_add_title">Add MCP Server</div>
                    <div style="color:var(--s-muted,#64748b);font-size:13px;margin-top:4px" data-i18n="settings_mcp_add_subtitle">Manually configure a new MCP server connection</div>
                  </div>
                  <button class="s-btn s-btn-ghost" id="s-mcp-manual-close" style="font-size:18px;padding:4px 8px;line-height:1">&times;</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:16px">
                  <div>
                    <label style="display:block;font-weight:500;margin-bottom:6px" data-i18n="settings_mcp_server_type">Server Type</label>
                    <select id="s-mcpf-type" class="s-form-select" style="width:100%">
                      <option value="stdio">STDIO</option>
                      <option value="sse">SSE</option>
                      <option value="http">Streamable HTTP</option>
                    </select>
                  </div>
                  <div>
                    <label style="display:block;font-weight:500;margin-bottom:6px"><span data-i18n="settings_mcp_name">Server Name</span> <span style="color:#dc2626">*</span></label>
                    <input id="s-mcpf-name" class="s-form-input" placeholder="my-mcp-server" style="width:100%">
                  </div>
                  <div id="s-mcpf-command-wrap">
                    <label style="display:block;font-weight:500;margin-bottom:6px"><span data-i18n="settings_mcp_command">Command</span> <span style="color:#dc2626">*</span></label>
                    <textarea id="s-mcpf-command" class="s-form-input" rows="2" style="width:100%;resize:vertical;font-family:inherit" placeholder="npx -y @modelcontextprotocol/server-filesystem"></textarea>
                    <div style="color:var(--s-muted,#64748b);font-size:12px;margin-top:4px" data-i18n="settings_mcp_command_hint">Paste full command, e.g. npx -y @modelcontextprotocol/server-filesystem</div>
                  </div>
                  <div id="s-mcpf-url-wrap" style="display:none">
                    <label style="display:block;font-weight:500;margin-bottom:6px"><span data-i18n="settings_mcp_url">URL</span> <span style="color:#dc2626">*</span></label>
                    <input id="s-mcpf-url" class="s-form-input" placeholder="http://localhost:8080/sse" style="width:100%">
                  </div>
                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                      <label style="margin:0;font-weight:500"><span data-i18n="settings_mcp_env">Environment Variables</span> <span style="color:var(--s-muted,#64748b);font-weight:400" data-i18n="settings_mcp_env_optional">(optional)</span></label>
                      <button class="s-btn s-btn-ghost" id="s-mcpf-paste-env" style="font-size:12px;padding:2px 8px" data-i18n="settings_mcp_env_paste">Paste</button>
                    </div>
                    <div id="s-mcpf-env-rows"></div>
                    <button class="s-btn s-btn-ghost" id="s-mcpf-add-env" style="font-size:12px;padding:4px 0" data-i18n="settings_mcp_env_add">+ Add Variable</button>
                  </div>
                  <div>
                    <label style="display:block;font-weight:500;margin-bottom:6px"><span data-i18n="settings_mcp_timeout">Timeout</span> <span style="color:var(--s-muted,#64748b);font-weight:400" data-i18n="settings_mcp_timeout_optional">(optional)</span></label>
                    <input id="s-mcpf-timeout" class="s-form-input" type="number" placeholder="60" style="width:100%">
                  </div>
                </div>
                <button class="s-btn s-btn-primary" id="s-mcpf-save" style="width:100%;padding:12px;margin-top:16px;font-size:15px" data-i18n="settings_mcp_btn_add">Add</button>
              </div>

              <!-- JSON Import Form -->
              <div id="s-mcp-json-form" class="s-form" style="display:none">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
                  <div>
                    <div style="font-weight:600;font-size:16px" data-i18n="settings_mcp_json_title">Import via JSON</div>
                    <div style="color:var(--s-muted,#64748b);font-size:13px;margin-top:4px" data-i18n="settings_mcp_json_subtitle">Paste your config JSON</div>
                  </div>
                  <button class="s-btn s-btn-ghost" id="s-mcp-json-close" style="font-size:18px;padding:4px 8px;line-height:1">&times;</button>
                </div>
                <textarea id="s-mcpf-json" class="s-form-input" rows="16" style="width:100%;font-family:monospace;font-size:13px;resize:vertical" placeholder='// You can use either format:
// STDIO example:
{
  "mcpServers": {
    "stdio-server-example": {
      "command": "npx",
      "args": ["-y", "mcp-server-example"]
    }
  }
}

// SSE example:
{
  "mcpServers": {
    "sse-server-example": {
      "url": "http://localhost:8080/sse"
    }
  }
}

// Streamable HTTP example:
{
  "mcpServers": {
    "http-server-example": {
      "url": "http://localhost:8080/mcp"
    }
  }
}

// With OAuth authentication:
{
  "mcpServers": {
    "oauth-server-example": {
      "url": "https://api.example.com/mcp",
      "authType": "oauth"
    }
  }
}'></textarea>
                <button class="s-btn s-btn-primary" id="s-mcpf-json-import" style="width:100%;padding:12px;margin-top:8px;font-size:15px" data-i18n="settings_mcp_btn_import">Import</button>
              </div>

              <div id="s-mcp-wrap"></div>
              <div id="s-mcp-empty" class="s-empty" style="display:none" data-i18n="settings_mcp_empty">No MCP servers configured.</div>
            </div>
          </div>

          <!-- Skills tab -->
          <div class="settings-tab-panel" id="stab-skills">
            <div class="settings-section">
              <div class="settings-section-header">
                <div class="settings-section-header-title" data-i18n="settings_skills">Skills</div>
                <button class="s-btn s-btn-primary" id="sk-upload-btn" data-i18n="settings_skills_upload_btn">+ Install Skill</button>
              </div>
              <div class="settings-section-desc" data-i18n="settings_skills_desc">Install and manage skills to extend Klaus with specialized capabilities.</div>
              <div class="sk-tabs">
                <button class="sk-tab active" data-sk-filter="market" data-i18n="settings_skills_market">Marketplace</button>
                <button class="sk-tab" data-sk-filter="builtin" data-i18n="settings_skills_builtin">Built-in</button>
                <button class="sk-tab" data-sk-filter="installed" data-i18n="settings_skills_installed">Installed</button>
                <button class="sk-tab" data-sk-filter="enabled" data-i18n="settings_skills_enabled">Enabled</button>
                <button class="sk-tab" data-sk-filter="disabled" data-i18n="settings_skills_disabled">Disabled</button>
              </div>
              <input class="s-form-input sk-search" id="sk-search" placeholder="Search skills..." data-i18n-placeholder="settings_skills_search">
              <div class="sk-grid" id="sk-grid"></div>
              <div class="sk-empty" id="sk-empty" style="display:none" data-i18n="settings_skills_empty">No skills found.</div>
            </div>
            <!-- Upload modal -->
            <div class="ch-modal-overlay" id="sk-upload-modal">
              <div class="ch-modal">
                <div class="ch-modal-header">
                  <div style="font-weight:600" data-i18n="settings_skills_upload_title">Install Skill</div>
                  <button class="ch-modal-close" id="sk-upload-close">&times;</button>
                </div>
                <div class="ch-modal-body">
                  <div class="sk-dropzone" id="sk-dropzone">
                    <div style="font-size:32px;margin-bottom:12px;opacity:0.4">\u{1F4E6}</div>
                    <div data-i18n="settings_skills_upload_desc">Drop a .zip or SKILL.md file, or click to browse</div>
                    <input type="file" id="sk-file-input" accept=".zip,.md" style="display:none">
                  </div>
                  <div class="sk-upload-hints">
                    <div>\u2022 .zip containing SKILL.md</div>
                    <div>\u2022 single SKILL.md file</div>
                  </div>
                  <div id="sk-upload-status" style="display:none"></div>
                </div>
              </div>
            </div>
          </div>

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
