/**
 * Chat UI HTML template for the web channel.
 *
 * Assembles a complete HTML document from modular parts:
 * - web-ui-css.ts      — CSS styles
 * - web-ui-html.ts     — HTML body markup
 * - web-ui-i18n.ts     — i18n translation dictionaries
 * - web-ui-settings-js.ts — Settings panel JS (tabs, MCP, Cron, Channels)
 * - web-ui-chat-js.ts  — Chat/session/WebSocket JS
 *
 * This file provides the shell (head, script tags, auth, init) and glue code.
 */

import { getChatCss } from "./web-ui-css.js";
import { getChatBodyHtml } from "./web-ui-html.js";
import { getChatI18n } from "./web-ui-i18n.js";
import { getSettingsJs } from "./web-ui-settings-js.js";
import { getChatMainJs } from "./web-ui-chat-js.js";
import { getMessagesJs } from "./web-ui-messages-js.js";
import { getDialogCss, getDialogJs } from "./web-ui-dialog.js";

export function getChatHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Klaus AI</title>
<link rel="icon" type="image/png" href="/logo.png">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github.min.css">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"><\/script>
<style>
${getChatCss()}
${getDialogCss()}
</style>
</head>
<body>
${getChatBodyHtml()}
<script>
(function(){
  // --- Theme ---
  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(localStorage.getItem("klaus_theme") || "auto");

  // --- i18n ---
${getChatI18n()}
  var currentLang = localStorage.getItem("klaus_lang") || "en";
  function tt(key) { return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key; }
  window.tt = tt;
${getDialogJs()}
  function notifyIframes(data) {
    document.querySelectorAll("iframe").forEach(function(f) {
      if (f.contentWindow) f.contentWindow.postMessage(data, "*");
    });
  }
  function setLang(lang) {
    if (!I18N[lang]) return;
    currentLang = lang;
    localStorage.setItem("klaus_lang", lang);
    applyI18n();
    notifyIframes({ type: "klaus-settings", lang: lang });
    // Persist to backend so LLM uses the preferred language
    fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: lang === "zh" ? "中文" : lang === "en" ? "English" : lang }),
    }).catch(function() {});
  }
  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function(el) {
      el.textContent = tt(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
      el.placeholder = tt(el.getAttribute("data-i18n-placeholder"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function(el) {
      el.title = tt(el.getAttribute("data-i18n-title"));
    });
    i18nCallbacks.forEach(function(cb) { cb(); });
  }
  var i18nCallbacks = [];

  if (typeof marked !== "undefined") {
    marked.use({ breaks: true, gfm: true, renderer: {
      html: function(token) { return escHtml(typeof token === "string" ? token : token.text); },
      image: function() { return ""; },
      link: function(token) {
        var href = (typeof token === "string" ? token : token.href) || "";
        var text = (typeof token === "string" ? "" : token.text) || href;
        if (!/^https?:\\/\\//i.test(href)) return escHtml(text);
        return '<a href="' + escAttr(href) + '" target="_blank" rel="noopener noreferrer">' + escHtml(text) + '</a>';
      }
    }});
  }

  applyI18n();

  // Auth
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function(r) {
      if (!r.ok) throw new Error("not authenticated");
      return r.json();
    })
    .then(function(data) {
      var u = data.user;
      u.name = u.displayName || u.name || "";
      u.avatar = u.avatarUrl || u.avatar || null;
      initChat(u, u.role === "admin");
    })
    .catch(function() { location.href = "/login"; });

  function initChat(currentUser, isAdmin) {

  var msgs = document.getElementById("messages");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var statusEl = document.getElementById("status");
  var attachBtn = document.getElementById("attach");
  var fileInput = document.getElementById("file-input");
  var previewsEl = document.getElementById("previews");
  var sidebar = document.getElementById("sidebar");
  var sidebarOverlay = document.getElementById("sidebar-overlay");
  var menuBtn = document.getElementById("menu-btn");
  var newChatBtn = document.getElementById("new-chat-btn");
  var sessionListEl = document.getElementById("session-list");
  var welcomeEl = document.getElementById("welcome");
  var sidebarToggleBtn = document.getElementById("sidebar-toggle");
  var busy = false;

  // --- Sidebar collapse (desktop only) ---
  var sidebarCollapsed = localStorage.getItem("klaus_sidebar_collapsed") === "1";
  if (sidebarCollapsed) sidebar.classList.add("collapsed");
  sidebarToggleBtn.addEventListener("click", function() {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle("collapsed", sidebarCollapsed);
    localStorage.setItem("klaus_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
  });

  // --- User info in sidebar footer ---
  var avatarEl = document.getElementById("sidebar-avatar");
  var usernameEl = document.getElementById("sidebar-username");
  var initial = (currentUser.name || currentUser.email || "U").charAt(0).toUpperCase();
  if (currentUser.avatar) {
    avatarEl.innerHTML = '<img src="' + currentUser.avatar + '" alt="">';
  } else {
    avatarEl.textContent = initial;
  }
  usernameEl.textContent = currentUser.name || currentUser.email || "User";

  // --- User menu ---
  var userMenuEl = document.getElementById("user-menu");
  var sidebarUserEl = document.getElementById("sidebar-user");
  var userMenuOpen = false;

  function renderUserMenu() {
    var checkSvg = '<svg class="menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var arrowSvg = '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
    userMenuEl.innerHTML =
      '<div class="user-menu-email">' + escHtml(currentUser.email || "") + '</div>' +
      '<button class="user-menu-item" id="menu-settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>' + tt("menu_settings") + '</span></button>' +
      '<button class="user-menu-item" id="menu-language"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>' + tt("menu_language") + '</span>' + arrowSvg + '</button>' +
      (isAdmin ? '<button class="user-menu-item" id="menu-admin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span>' + tt("menu_admin") + '</span></button>' : '') +
      '<button class="user-menu-item" id="menu-help"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>' + tt("menu_help") + '</span></button>' +
      '<div class="user-menu-sep"></div>' +
      '<button class="user-menu-item" id="menu-logout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>' + tt("menu_logout") + '</span></button>';
  }
  renderUserMenu();
  i18nCallbacks.push(renderUserMenu);

  function toggleUserMenu() {
    userMenuOpen = !userMenuOpen;
    userMenuEl.classList.toggle("open", userMenuOpen);
  }
  function closeUserMenu() {
    userMenuOpen = false;
    userMenuEl.classList.remove("open");
    var lp = document.getElementById("user-menu-lang");
    if (lp) lp.classList.remove("open");
  }

  sidebarUserEl.addEventListener("click", function(e) {
    e.stopPropagation();
    toggleUserMenu();
  });
  var langPanelEl = document.getElementById("user-menu-lang");
  var langPanelOpen = false;

  function renderLangPanel() {
    var checkSvg = '<svg class="menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
    langPanelEl.innerHTML =
      '<button class="user-menu-item' + (currentLang === "en" ? " active" : "") + '" data-lang="en"><span>English</span>' + checkSvg + '</button>' +
      '<button class="user-menu-item' + (currentLang === "zh" ? " active" : "") + '" data-lang="zh"><span>中文</span>' + checkSvg + '</button>';
  }
  function toggleLangPanel(show) {
    langPanelOpen = show;
    langPanelEl.classList.toggle("open", show);
    var langItem = document.getElementById("menu-language");
    if (langItem) langItem.classList.toggle("selected", show);
    if (show) {
      renderLangPanel();
      var rect = langItem.getBoundingClientRect();
      langPanelEl.style.left = (rect.right + 8) + "px";
      langPanelEl.style.top = rect.top + "px";
    }
  }
  function closeLangPanel() { toggleLangPanel(false); }

  langPanelEl.addEventListener("click", function(e) {
    e.stopPropagation();
    var target = e.target.closest("[data-lang]");
    if (target) {
      setLang(target.getAttribute("data-lang"));
      renderLangPanel();
    }
  });

  userMenuEl.addEventListener("click", function(e) {
    e.stopPropagation();
    var item = e.target.closest(".user-menu-item");
    if (!item) return;
    if (item.id === "menu-settings") {
      closeUserMenu();
      showSettings();
    } else if (item.id === "menu-admin") {
      closeUserMenu();
      showAdmin();
    } else if (item.id === "menu-language") {
      toggleLangPanel(!langPanelOpen);
    } else if (item.id === "menu-help") {
      closeUserMenu();
      window.open("https://github.com/meitianwang/klaus", "_blank");
    } else if (item.id === "menu-logout") {
      closeUserMenu();
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
        .finally(function() { location.href = "/login"; });
    }
  });
  document.addEventListener("click", function() { closeUserMenu(); closeLangPanel(); });

  // --- Shared: chat elements to hide/show ---
  var chatElements = [document.getElementById("header"), document.getElementById("welcome"), document.getElementById("messages"), document.getElementById("input-wrapper"), document.getElementById("artifacts-panel")];

  // --- Admin view ---
  var adminView = document.getElementById("admin-view");
  var adminIframe = document.getElementById("admin-iframe");
  function showAdmin() {
    document.getElementById("settings-view").style.display = "none";
    adminView.style.display = "flex";
    chatElements.forEach(function(el) { if (el) el.style.display = "none"; });
    if (!adminIframe.src || adminIframe.src === "about:blank" || !adminIframe.src.includes("/admin")) {
      adminIframe.src = "/admin?embed=1";
    }
  }
  function hideAdmin() {
    adminView.style.display = "none";
    chatElements.forEach(function(el) { if (el) el.style.display = ""; });
  }
  document.getElementById("admin-back").addEventListener("click", function() {
    hideAdmin();
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname);
  });

  // Auto-open admin view when navigated to /#admin
  if (location.hash === "#admin") showAdmin();

  // --- Settings view ---
  var settingsView = document.getElementById("settings-view");

${getSettingsJs()}

${getChatMainJs()}

${getMessagesJs()}

  } // end initChat
})();
<\/script>
</body>
</html>`;
}
