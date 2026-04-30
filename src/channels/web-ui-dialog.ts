/**
 * Klaus Web — Custom dialog (replaces native confirm/alert).
 * Mirrors the desktop renderer (apps/electron/src/renderer/js/dialog.js) so chat & admin
 * pages share the same look-and-feel as the Electron app.
 *
 * DO NOT use window.confirm / window.alert / window.prompt in any web UI.
 * Use window.klausDialog.confirm({...}) / window.klausDialog.alert({...}) instead.
 */

export function getDialogCss(): string {
  return `
.klaus-dialog-overlay {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  z-index: 2000; opacity: 0;
  transition: opacity 0.16s ease;
}
.klaus-dialog-overlay.active { opacity: 1; }
.klaus-dialog-backdrop {
  position: absolute; inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
}
.klaus-dialog-card {
  position: relative;
  background: var(--bg-elevated, var(--card-bg, #ffffff));
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius-md, 12px);
  box-shadow: var(--shadow-lg, 0 24px 48px -12px rgba(0,0,0,0.18));
  width: min(92vw, 380px);
  padding: 22px 22px 18px;
  transform: scale(0.96);
  transition: transform 0.16s ease;
}
.klaus-dialog-overlay.active .klaus-dialog-card { transform: scale(1); }
.klaus-dialog-title {
  font-size: 15px; font-weight: 600;
  color: var(--fg, #0f172a);
  margin-bottom: 8px; line-height: 1.4;
}
.klaus-dialog-message {
  font-size: 13.5px;
  color: var(--fg-secondary, var(--muted, #475569));
  line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
  margin-bottom: 20px;
}
.klaus-dialog-checkbox {
  display: flex; align-items: center; gap: 8px;
  margin: -8px 0 16px;
  font-size: 13px; color: var(--fg-secondary, var(--muted, #475569));
  cursor: pointer; user-select: none;
}
.klaus-dialog-checkbox input { cursor: pointer; margin: 0; }
.klaus-dialog-checkbox:hover { color: var(--fg, #0f172a); }
.klaus-dialog-footer {
  display: flex; justify-content: flex-end; gap: 8px;
}
.klaus-dialog-btn {
  padding: 7px 16px;
  border-radius: var(--radius-sm, 8px);
  font-family: var(--font, var(--font-main, inherit));
  font-size: 13px; font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer; min-width: 72px;
  transition: background var(--transition, 150ms ease), border-color var(--transition, 150ms ease), color var(--transition, 150ms ease);
}
.klaus-dialog-btn:focus-visible {
  outline: 2px solid var(--accent, #020617);
  outline-offset: 1px;
}
.klaus-dialog-cancel {
  background: transparent;
  color: var(--fg, #0f172a);
  border-color: var(--border, #e2e8f0);
}
.klaus-dialog-cancel:hover { background: var(--bg-hover, #f1f5f9); }
.klaus-dialog-confirm {
  background: var(--accent, #020617);
  color: var(--accent-text, #ffffff);
}
.klaus-dialog-confirm:hover { background: var(--accent-hover, #334155); }
.klaus-dialog-confirm.klaus-dialog-danger {
  background: #dc2626;
  color: #ffffff;
  border-color: #dc2626;
}
.klaus-dialog-confirm.klaus-dialog-danger:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}
`;
}

export function getDialogJs(): string {
  return `
(function () {
  if (window.klausDialog) return;
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ESC_MAP[c]; }); }
  function tt(k, fb) {
    var v = (typeof window.tt === 'function') ? window.tt(k) : k;
    return (v === k) ? (fb == null ? k : fb) : v;
  }
  function ensureRoot() {
    var root = document.getElementById('klaus-dialog-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'klaus-dialog-root';
      document.body.appendChild(root);
    }
    return root;
  }
  function openDialog(opts) {
    opts = opts || {};
    var type = opts.type || 'confirm';
    var title = opts.title || '';
    var message = opts.message || '';
    var danger = !!opts.danger;
    var checkbox = opts.checkbox || null;
    return new Promise(function(resolve) {
      var root = ensureRoot();
      var overlay = document.createElement('div');
      overlay.className = 'klaus-dialog-overlay';
      var okFallback = danger ? tt('delete_title', 'Delete') : tt('dialog_ok', 'OK');
      var ct = esc(opts.confirmText == null ? okFallback : opts.confirmText);
      var cx = esc(opts.cancelText == null ? tt('cancel', 'Cancel') : opts.cancelText);
      var checkboxId = checkbox ? ('klaus-dialog-cb-' + Math.random().toString(36).slice(2, 8)) : '';
      overlay.innerHTML =
        '<div class="klaus-dialog-backdrop"></div>' +
        '<div class="klaus-dialog-card" role="dialog" aria-modal="true">' +
          (title ? '<div class="klaus-dialog-title">' + esc(title) + '</div>' : '') +
          '<div class="klaus-dialog-message">' + esc(message) + '</div>' +
          (checkbox ? (
            '<label class="klaus-dialog-checkbox" for="' + checkboxId + '">' +
              '<input type="checkbox" id="' + checkboxId + '"' + (checkbox.defaultChecked ? ' checked' : '') + ' />' +
              '<span>' + esc(checkbox.label || '') + '</span>' +
            '</label>'
          ) : '') +
          '<div class="klaus-dialog-footer">' +
            (type === 'confirm' ? '<button class="klaus-dialog-btn klaus-dialog-cancel" type="button">' + cx + '</button>' : '') +
            '<button class="klaus-dialog-btn klaus-dialog-confirm' + (danger ? ' klaus-dialog-danger' : '') + '" type="button">' + ct + '</button>' +
          '</div>' +
        '</div>';
      root.appendChild(overlay);
      requestAnimationFrame(function(){ overlay.classList.add('active'); });
      var cb = checkbox ? overlay.querySelector('#' + checkboxId) : null;
      var closed = false;
      function close(confirmed) {
        if (closed) return;
        closed = true;
        overlay.classList.remove('active');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(function(){ overlay.remove(); }, 160);
        if (checkbox && type === 'confirm') {
          resolve({ confirmed: confirmed, checked: !!(confirmed && cb && cb.checked) });
        } else {
          resolve(confirmed);
        }
      }
      var cancelValue = type === 'confirm' ? false : undefined;
      var confirmValue = type === 'confirm' ? true : undefined;
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelValue); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(confirmValue); }
      }
      document.addEventListener('keydown', onKey, true);
      overlay.querySelector('.klaus-dialog-backdrop').addEventListener('click', function(){ close(cancelValue); });
      overlay.querySelector('.klaus-dialog-confirm').addEventListener('click', function(){ close(confirmValue); });
      var cancelBtn = overlay.querySelector('.klaus-dialog-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', function(){ close(false); });
      setTimeout(function(){
        var btn = overlay.querySelector('.klaus-dialog-confirm');
        if (btn) btn.focus();
      }, 0);
    });
  }
  function normalize(input, extra) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return Object.assign({}, input, extra || {});
    }
    return Object.assign({ message: String(input == null ? '' : input) }, extra || {});
  }
  window.klausDialog = {
    confirm: function(input, extra){ return openDialog(Object.assign({ type: 'confirm' }, normalize(input, extra))); },
    alert: function(input, extra){ return openDialog(Object.assign({ type: 'alert' }, normalize(input, extra))); },
  };
})();
`;
}
