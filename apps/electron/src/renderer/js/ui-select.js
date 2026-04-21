// Klaus Desktop — unified custom dropdown (replaces native <select>).
// Extracted from cron.js's .cron-dd-* implementation so every page uses the
// same trigger/panel/check-icon styling instead of the OS-native picker.
//
// Usage:
//   window.klsSelect.bind(rootEl, { onChange, items?, value? })
//   → returns { setValue, getValue, setItems, close, el }
//
// Markup (items can be inlined or passed via options.items and rendered later):
//   <div class="kls-select">
//     <button type="button" class="kls-select-trigger">
//       <span class="kls-select-text"></span>
//       <svg class="kls-select-caret" viewBox="0 0 12 12" fill="none"
//            stroke="currentColor" stroke-width="1.5">
//         <polyline points="3,4.5 6,7.5 9,4.5"/>
//       </svg>
//     </button>
//     <div class="kls-select-panel" hidden></div>
//   </div>

(function () {
  const CARET_SVG =
    `<svg class="kls-select-caret" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,4.5 6,7.5 9,4.5"/></svg>`
  const CHECK_SVG = ''  // .is-selected::after draws the check via CSS mask

  // Position a panel below its trigger in viewport coords. Flips horizontally
  // when overflowing right, vertically when overflowing bottom. Same algorithm
  // as cron.js's positionPopup so behavior matches across the app.
  function positionPanel(trigger, panel) {
    const rect = trigger.getBoundingClientRect()
    panel.style.top = (rect.bottom + 4) + 'px'
    panel.style.left = rect.left + 'px'
    panel.style.right = 'auto'
    requestAnimationFrame(() => {
      const pr = panel.getBoundingClientRect()
      if (pr.right > window.innerWidth - 8) {
        panel.style.left = Math.max(8, rect.right - pr.width) + 'px'
      }
      if (pr.bottom > window.innerHeight - 8) {
        panel.style.top = Math.max(8, rect.top - pr.height - 4) + 'px'
      }
    })
  }

  // Track every bound instance so outside-click / Escape / scroll close them
  // all at once. Weakly held via the DOM node; detach on element removal.
  const instances = new Set()

  document.addEventListener('click', (e) => {
    for (const inst of instances) {
      if (inst.el.classList.contains('open') && !inst.el.contains(e.target)) inst.close()
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    for (const inst of instances) if (inst.el.classList.contains('open')) inst.close()
  })
  // Close on scroll — a fixed-position panel would otherwise detach from its
  // trigger when the page scrolls underneath it.
  window.addEventListener('scroll', () => {
    for (const inst of instances) if (inst.el.classList.contains('open')) inst.close()
  }, true)
  // Re-translate items whose content came from an i18nKey (fired by i18n.js
  // on setLanguage — the static [data-i18n] DOM walk can't reach items we
  // rendered via innerHTML).
  window.addEventListener('klaus:lang-change', () => {
    for (const inst of instances) inst.refresh()
  })

  function renderItems(panel, items, selectedValue, labelOf) {
    panel.innerHTML = items.map(it => {
      const sel = it.value === selectedValue ? ' is-selected' : ''
      const label = escapeHtml(labelOf(it))
      return `<button type="button" class="kls-select-item${sel}" data-value="${escapeAttr(it.value)}">${label}</button>`
    }).join('')
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function escapeAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function bind(root, opts = {}) {
    if (!root) throw new Error('klsSelect.bind: root element is required')
    if (root.__klsSelect) return root.__klsSelect  // idempotent

    let trigger = root.querySelector('.kls-select-trigger')
    let textEl = root.querySelector('.kls-select-text')
    let panel = root.querySelector('.kls-select-panel')

    // Auto-scaffold when only the wrapper was provided
    if (!trigger) {
      root.innerHTML = `
        <button type="button" class="kls-select-trigger">
          <span class="kls-select-text"></span>
          ${CARET_SVG}
        </button>
        <div class="kls-select-panel" hidden></div>`
      trigger = root.querySelector('.kls-select-trigger')
      textEl = root.querySelector('.kls-select-text')
      panel = root.querySelector('.kls-select-panel')
    } else if (!root.querySelector('.kls-select-caret')) {
      trigger.insertAdjacentHTML('beforeend', CARET_SVG)
    }

    // Internal item model: array of { value, label, i18nKey? }. i18nKey wins
    // over label — on language change we re-resolve tt(i18nKey). Initial items
    // can come from HTML (each item can carry data-i18n) or opts.items.
    let items = opts.items
    if (!items) {
      items = [...panel.querySelectorAll('.kls-select-item')].map(b => ({
        value: b.dataset.value,
        label: b.textContent,
        i18nKey: b.dataset.i18n || undefined,
      }))
    }
    // Normalize: resolve i18nKey → label at bind time.
    const resolveLabel = (it) => (it.i18nKey && typeof window.tt === 'function')
      ? window.tt(it.i18nKey)
      : (it.label ?? String(it.value))
    let value = opts.value != null ? String(opts.value) : (items[0]?.value ?? '')
    const placeholder = opts.placeholder ?? ''

    function open() {
      // Close any other open select first — one dropdown at a time.
      for (const inst of instances) if (inst !== api && inst.el.classList.contains('open')) inst.close()
      root.classList.add('open')
      trigger.setAttribute('aria-expanded', 'true')
      panel.hidden = false
      positionPanel(trigger, panel)
    }
    function close() {
      root.classList.remove('open')
      trigger.setAttribute('aria-expanded', 'false')
      panel.hidden = true
    }
    function refresh() {
      renderItems(panel, items, value, resolveLabel)
      const match = items.find(it => String(it.value) === String(value))
      textEl.textContent = match ? resolveLabel(match) : (placeholder || '')
      textEl.classList.toggle('is-placeholder', !match && !!placeholder)
    }
    function setValue(v, { silent = true } = {}) {
      value = v == null ? '' : String(v)
      refresh()
      if (!silent) opts.onChange?.(value)
    }
    function setItems(next, { value: nextValue } = {}) {
      items = Array.isArray(next)
        ? next.map(it => ({ value: String(it.value), label: it.label, i18nKey: it.i18nKey }))
        : []
      if (nextValue !== undefined) value = nextValue == null ? '' : String(nextValue)
      // If the current value no longer exists in the new list, reset to first.
      if (!items.some(it => it.value === value)) value = items[0]?.value ?? ''
      refresh()
    }

    trigger.setAttribute('aria-haspopup', 'listbox')
    trigger.setAttribute('aria-expanded', 'false')
    panel.setAttribute('role', 'listbox')
    if (opts.disabled) {
      root.classList.add('is-disabled')
      trigger.setAttribute('aria-disabled', 'true')
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      if (root.classList.contains('is-disabled')) return
      root.classList.contains('open') ? close() : open()
    })
    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.kls-select-item')
      if (!item) return
      const next = item.dataset.value
      if (next === value) { close(); return }
      value = next
      refresh()
      close()
      opts.onChange?.(value)
    })

    const api = {
      el: root,
      setValue,
      getValue: () => value,
      setItems,
      refresh,
      open,
      close,
    }
    root.__klsSelect = api
    instances.add(api)

    // Mirror <select>.value so helpers like gv(id)=el.value keep working
    // without every caller having to know about the new API.
    Object.defineProperty(root, 'value', {
      configurable: true,
      get: () => value,
      set: (v) => setValue(v),
    })

    refresh()
    return api
  }

  window.klsSelect = { bind }
})()
