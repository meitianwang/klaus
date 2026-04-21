// Klaus Desktop — Scheduled Tasks view
// Two tabs: "My Tasks" (grid of task cards) + "Run History" (timeline).
// Filters: task sort on My Tasks; task + status filters on Run History.
// Keep-awake toggle: powerSaveBlocker on the main side.

(function () {
  const api = window.klaus.settings.cron

  // ---- DOM ----
  const view = document.getElementById('cron-view')
  const refreshBtn = document.getElementById('cron-refresh')
  const viaKlausBtn = document.getElementById('cron-via-klaus')
  const newBtn = document.getElementById('cron-new-btn')
  const tabs = view.querySelectorAll('.cron-tab')
  const paneTasks = document.getElementById('cron-pane-tasks')
  const paneRuns = document.getElementById('cron-pane-runs')
  const filterGroupTasks = view.querySelector('[data-for-tab="tasks"]')
  const filterGroupRuns = view.querySelector('[data-for-tab="runs"]')
  const sortSelectEl = document.getElementById('cron-sort')
  const sortSelect = window.klsSelect.bind(sortSelectEl, {
    items: [
      { value: 'created_desc',  i18nKey: 'cron_sort_created_desc' },
      { value: 'created_asc',   i18nKey: 'cron_sort_created_asc' },
      { value: 'name_asc',      i18nKey: 'cron_sort_name_asc' },
      { value: 'enabled_first', i18nKey: 'cron_sort_enabled_first' },
    ],
    value: 'created_desc',
    onChange: (v) => { currentSort = v; renderTasks() },
  })
  const runsTaskFilter = window.klsSelect.bind(document.getElementById('cron-runs-task'), {
    items: [{ value: '', i18nKey: 'cron_task_all' }],
    value: '',
    onChange: () => loadRuns(),
  })
  const runsStatusFilter = window.klsSelect.bind(document.getElementById('cron-runs-status'), {
    items: [
      { value: '',        i18nKey: 'cron_status_all' },
      { value: 'success', i18nKey: 'cron_status_success' },
      { value: 'failed',  i18nKey: 'cron_status_failed' },
      { value: 'running', i18nKey: 'cron_status_running' },
    ],
    value: '',
    onChange: () => loadRuns(),
  })
  const grid = document.getElementById('cron-grid')
  const emptyTasks = document.getElementById('cron-empty')
  const runsList = document.getElementById('cron-runs-list')
  const emptyRuns = document.getElementById('cron-runs-empty')

  const modal = document.getElementById('cron-modal')
  const modalBackdrop = document.getElementById('cron-modal-backdrop')
  const modalTitle = document.getElementById('cron-modal-title')
  const modalClose = document.getElementById('cron-modal-close')
  const fName = document.getElementById('cron-form-name')
  const fFreq = document.getElementById('cron-form-freq')
  const fWeekday = document.getElementById('cron-form-weekday')
  const fMonthday = document.getElementById('cron-form-monthday')
  const fDate = document.getElementById('cron-form-date')
  const fIntervalWrap = document.getElementById('cron-form-interval-wrap')
  const fInterval = document.getElementById('cron-form-interval')
  const fTime = document.getElementById('cron-form-time')
  const fSchedule = document.getElementById('cron-form-schedule')
  const fScheduleHint = document.getElementById('cron-form-schedule-hint')
  const fTzRow = document.getElementById('cron-form-tz-row')
  const fTzWrap = document.getElementById('cron-form-tz')
  const fTimezone = document.getElementById('cron-form-timezone')
  const fTzPanel = fTzWrap.querySelector('.cron-tz-panel')
  const fPrompt = document.getElementById('cron-form-prompt')
  const saveBtn = document.getElementById('cron-form-save')
  const cancelBtn = document.getElementById('cron-form-cancel')

  // Day-of-month dropdown (1-31) populated once.
  {
    const panel = fMonthday.querySelector('.cron-dd-panel')
    for (let d = 1; d <= 31; d++) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cron-dd-item'
      btn.setAttribute('role', 'option')
      btn.dataset.value = String(d)
      btn.textContent = String(d)
      panel.appendChild(btn)
    }
  }

  // Timezone list (IANA) — populated lazily into the custom autocomplete panel.
  let TZ_ALL = []
  try { TZ_ALL = Intl.supportedValuesOf?.('timeZone') || [] } catch {}

  // Position a popup below its anchor using viewport coords (the popups use
  // `position: fixed` so they escape the modal's overflow clipping). Flips to
  // align right edge when the popup would spill off-screen.
  function positionPopup(anchor, popup) {
    const rect = anchor.getBoundingClientRect()
    popup.style.top = (rect.bottom + 4) + 'px'
    popup.style.left = rect.left + 'px'
    popup.style.right = 'auto'
    requestAnimationFrame(() => {
      const pr = popup.getBoundingClientRect()
      if (pr.right > window.innerWidth - 8) {
        popup.style.left = Math.max(8, rect.right - pr.width) + 'px'
      }
      if (pr.bottom > window.innerHeight - 8) {
        popup.style.top = Math.max(8, rect.top - pr.height - 4) + 'px'
      }
    })
  }

  // ---- Custom dropdown (button + floating panel) ----
  // Preferred over a native <select> so the open panel matches Klaus styling
  // rather than rendering as an OS-native list with system accent colors.
  function setupDd(root, onChange) {
    const trigger = root.querySelector('.cron-dd-trigger')
    const panel = root.querySelector('.cron-dd-panel')
    const textEl = root.querySelector('.cron-dd-text')

    function open() {
      closeAllPopups(root)
      root.classList.add('open')
      panel.hidden = false
      positionPopup(trigger, panel)
    }
    function close() {
      root.classList.remove('open')
      panel.hidden = true
    }
    function setValue(v) {
      root.dataset.value = v
      const item = panel.querySelector('.cron-dd-item[data-value="' + (window.CSS?.escape ? CSS.escape(v) : v) + '"]')
      if (item) textEl.textContent = item.textContent
      panel.querySelectorAll('.cron-dd-item').forEach(it => it.classList.toggle('is-selected', it.dataset.value === v))
    }
    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      root.classList.contains('open') ? close() : open()
    })
    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.cron-dd-item')
      if (!item) return
      setValue(item.dataset.value)
      close()
      onChange?.(item.dataset.value)
    })
    root.__dd = { setValue, close, getValue: () => root.dataset.value }
    return root.__dd
  }

  // Close every open popup except the one being opened. One global close fn so
  // dropdowns, calendar, time-wheel, and tz autocomplete all play nice.
  function closeAllPopups(keep) {
    document.querySelectorAll('.cron-dd.open').forEach(d => { if (d !== keep) d.__dd?.close() })
    if (keep !== fDate) closeDatePopup()
    if (keep !== fTime) closeTimePopup()
    if (keep !== fTzWrap) closeTzPanel()
  }
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.cron-dd.open').forEach(dd => { if (!dd.contains(e.target)) dd.__dd?.close() })
    if (!fDate.contains(e.target)) closeDatePopup()
    if (!fTime.contains(e.target)) closeTimePopup()
    if (!fTzWrap.contains(e.target)) closeTzPanel()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.cron-dd.open').forEach(dd => dd.__dd?.close())
      closeDatePopup()
      closeTimePopup()
      closeTzPanel()
    }
  })

  const ddFreq = setupDd(fFreq, (v) => setMode(v))
  const ddWeekday = setupDd(fWeekday)
  const ddMonthday = setupDd(fMonthday)

  // ---- Calendar date picker (YYYY-MM-DD) ----
  const DAY_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa']
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
  let dateViewY, dateViewM  // currently displayed month (independent of selection)

  function pad2(n) { return String(n).padStart(2, '0') }
  function fmtDate(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}` }

  const dateTrigger = fDate.querySelector('.cron-date-trigger')
  const dateText = fDate.querySelector('.cron-date-text')
  const datePopup = fDate.querySelector('.cron-date-popup')
  const dateTitle = fDate.querySelector('.cron-date-title')
  const dateWeekdays = fDate.querySelector('.cron-date-weekdays')
  const dateGrid = fDate.querySelector('.cron-date-grid')
  dateWeekdays.innerHTML = DAY_SHORT.map(d => `<span>${d}</span>`).join('')

  function openDatePopup() {
    closeAllPopups(fDate)
    datePopup.hidden = false
    fDate.classList.add('open')
    renderCalendar()
    positionPopup(dateTrigger, datePopup)
  }
  function closeDatePopup() { datePopup.hidden = true; fDate.classList.remove('open') }
  function setDateValue(iso) {
    fDate.dataset.value = iso || ''
    dateText.textContent = iso || t('cron_form_pick_date', 'Pick a date')
    if (iso) {
      const [y, m] = iso.split('-').map(Number)
      dateViewY = y; dateViewM = m - 1
    }
  }
  function renderCalendar() {
    const y = dateViewY, m = dateViewM
    dateTitle.textContent = `${MONTH_NAMES[m]} ${y}`
    const first = new Date(y, m, 1)
    const startDow = first.getDay()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const daysInPrev = new Date(y, m, 0).getDate()
    const selected = fDate.dataset.value
    const cells = []
    // Previous month tail
    for (let i = startDow - 1; i >= 0; i--) {
      cells.push({ day: daysInPrev - i, other: true })
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, other: false, iso: fmtDate(y, m + 1, d) })
    }
    // Next month leading — pad to 42 cells (6 rows)
    let next = 1
    while (cells.length < 42) cells.push({ day: next++, other: true })
    dateGrid.innerHTML = cells.map(c => {
      const isSel = c.iso && c.iso === selected
      const cls = 'cron-date-cell' + (c.other ? ' is-other' : '') + (isSel ? ' is-selected' : '')
      return c.iso
        ? `<button type="button" class="${cls}" data-iso="${c.iso}">${c.day}</button>`
        : `<span class="${cls}">${c.day}</span>`
    }).join('')
  }
  dateTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    datePopup.hidden ? openDatePopup() : closeDatePopup()
  })
  fDate.querySelectorAll('.cron-date-nav').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      dateViewM += parseInt(btn.dataset.dir, 10)
      if (dateViewM < 0) { dateViewM = 11; dateViewY-- }
      else if (dateViewM > 11) { dateViewM = 0; dateViewY++ }
      renderCalendar()
    })
  })
  dateGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cron-date-cell[data-iso]')
    if (!cell) return
    setDateValue(cell.dataset.iso)
    renderCalendar()
    closeDatePopup()
  })

  // ---- Wheel time picker (two scrollable columns, snap-on-scroll) ----
  const WHEEL_ITEM_H = 32
  const WHEEL_VISIBLE = 7   // odd: center row is active
  const WHEEL_PAD = Math.floor(WHEEL_VISIBLE / 2) * WHEEL_ITEM_H

  const timeTrigger = fTime.querySelector('.cron-time-trigger')
  const timeText = fTime.querySelector('.cron-time-text')
  const timePopup = fTime.querySelector('.cron-time-popup')
  const wheelHour = fTime.querySelector('[data-wheel="hour"]')
  const wheelMinute = fTime.querySelector('[data-wheel="minute"]')

  function buildWheel(el, values) {
    const frag = document.createDocumentFragment()
    const topPad = document.createElement('div')
    topPad.className = 'cron-wheel-pad'
    topPad.style.height = WHEEL_PAD + 'px'
    frag.appendChild(topPad)
    values.forEach(v => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cron-wheel-item'
      btn.dataset.value = String(v)
      btn.textContent = pad2(v)
      frag.appendChild(btn)
    })
    const botPad = document.createElement('div')
    botPad.className = 'cron-wheel-pad'
    botPad.style.height = WHEEL_PAD + 'px'
    frag.appendChild(botPad)
    el.appendChild(frag)
  }
  const hourValues = Array.from({ length: 24 }, (_, i) => i)
  const minuteValues = Array.from({ length: 60 }, (_, i) => i)
  buildWheel(wheelHour, hourValues)
  buildWheel(wheelMinute, minuteValues)

  function setWheelValue(el, n) {
    el.scrollTop = n * WHEEL_ITEM_H
    syncWheelActive(el)
  }
  function syncWheelActive(el) {
    const idx = Math.round(el.scrollTop / WHEEL_ITEM_H)
    el.querySelectorAll('.cron-wheel-item').forEach((it, i) => it.classList.toggle('is-active', i === idx))
  }
  function getWheelValue(el) {
    return Math.round(el.scrollTop / WHEEL_ITEM_H)
  }
  // Written after user scroll — wheel positions drive dataset + trigger text.
  function syncTimeFromWheels() {
    const hh = getWheelValue(wheelHour)
    const mm = getWheelValue(wheelMinute)
    fTime.dataset.hour = String(hh)
    fTime.dataset.minute = String(mm)
    timeText.textContent = `${pad2(hh)}:${pad2(mm)}`
  }
  // Authoritative setter — writes state even when wheels are inside a hidden
  // modal (setting scrollTop on display:none elements is a no-op, so we can't
  // round-trip through the wheels at load time).
  function setTimeValue(h, m) {
    const hh = Number(h) || 0
    const mm = Number(m) || 0
    fTime.dataset.hour = String(hh)
    fTime.dataset.minute = String(mm)
    timeText.textContent = `${pad2(hh)}:${pad2(mm)}`
    setWheelValue(wheelHour, hh)
    setWheelValue(wheelMinute, mm)
  }

  ;[wheelHour, wheelMinute].forEach(w => {
    let t
    w.addEventListener('scroll', () => {
      clearTimeout(t)
      t = setTimeout(() => { syncWheelActive(w); syncTimeFromWheels() }, 90)
    })
    w.addEventListener('click', (e) => {
      const item = e.target.closest('.cron-wheel-item')
      if (!item) return
      const parent = item.parentElement
      const idx = [...parent.querySelectorAll('.cron-wheel-item')].indexOf(item)
      parent.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' })
    })
  })

  timeTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    if (timePopup.hidden) {
      closeAllPopups(fTime)
      timePopup.hidden = false
      fTime.classList.add('open')
      positionPopup(timeTrigger, timePopup)
      // Re-sync scroll positions once panel is laid out.
      requestAnimationFrame(() => {
        setWheelValue(wheelHour, Number(fTime.dataset.hour) || 0)
        setWheelValue(wheelMinute, Number(fTime.dataset.minute) || 0)
      })
    } else {
      closeTimePopup()
    }
  })
  function closeTimePopup() { timePopup.hidden = true; fTime.classList.remove('open') }

  // ---- Timezone autocomplete (input + filtered Klaus-styled panel) ----
  function renderTzPanel() {
    const q = fTimezone.value.trim().toLowerCase()
    const matches = (q ? TZ_ALL.filter(z => z.toLowerCase().includes(q)) : TZ_ALL).slice(0, 60)
    if (!matches.length) { closeTzPanel(); return }
    fTzPanel.innerHTML = matches.map(z =>
      `<button type="button" class="cron-tz-item" data-value="${z}" role="option">${z}</button>`
    ).join('')
  }
  function openTzPanel() {
    closeAllPopups(fTzWrap)
    renderTzPanel()
    if (!fTzPanel.children.length) return
    fTzPanel.hidden = false
    fTzWrap.classList.add('open')
    positionPopup(fTimezone, fTzPanel)
  }
  function closeTzPanel() { fTzPanel.hidden = true; fTzWrap.classList.remove('open') }

  fTimezone.addEventListener('focus', openTzPanel)
  fTimezone.addEventListener('input', () => {
    if (fTzPanel.hidden) openTzPanel(); else { renderTzPanel(); positionPopup(fTimezone, fTzPanel) }
  })
  fTzPanel.addEventListener('mousedown', (e) => {
    // mousedown (not click) so blur doesn't fire first and close the panel.
    const item = e.target.closest('.cron-tz-item')
    if (!item) return
    e.preventDefault()
    fTimezone.value = item.dataset.value
    closeTzPanel()
  })
  fTimezone.addEventListener('blur', () => setTimeout(closeTzPanel, 120))

  // ---- State ----
  let cronVisible = false
  let currentTab = 'tasks'
  let currentSort = 'created_desc'
  let cachedTasks = []
  let editingId = null

  function t(key, fallback) {
    const v = window.tt ? window.tt(key) : key
    return v === key ? (fallback ?? key) : v
  }

  function show() {
    cronVisible = true
    view.classList.add('active')
    document.getElementById('settings-view')?.classList.remove('active')
    refreshAll()
  }
  function hide() {
    cronVisible = false
    view.classList.remove('active')
  }

  // ---- Refresh ----
  async function refreshAll() {
    await Promise.all([loadTasks(), loadRuns()])
  }

  function spinRefresh() {
    refreshBtn?.classList.add('spinning')
    setTimeout(() => refreshBtn?.classList.remove('spinning'), 600)
  }

  // ---- Tabs ----
  function switchTab(name) {
    currentTab = name
    tabs.forEach(b => b.classList.toggle('active', b.dataset.cronTab === name))
    paneTasks.classList.toggle('active', name === 'tasks')
    paneRuns.classList.toggle('active', name === 'runs')
    filterGroupTasks.style.display = name === 'tasks' ? '' : 'none'
    filterGroupRuns.style.display = name === 'runs' ? '' : 'none'
  }

  // ---- Tasks pane ----
  function sortTasks(tasks) {
    const list = [...tasks]
    switch (currentSort) {
      case 'created_asc':
        return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      case 'name_asc':
        return list.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
      case 'enabled_first':
        return list.sort((a, b) => Number(!!b.enabled) - Number(!!a.enabled) || (b.createdAt || 0) - (a.createdAt || 0))
      case 'created_desc':
      default:
        return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    }
  }

  async function loadTasks() {
    const tasks = (await api.list()) || []
    cachedTasks = tasks
    populateRunsTaskFilter(tasks)
    renderTasks()
    // Keep the left-sidebar "定时任务" pinned group in sync with whatever
    // just changed here (new/edited/deleted/toggled task).
    try { window.refreshCronSidebar?.() } catch {}
  }

  function renderTasks() {
    const tasks = sortTasks(cachedTasks)
    if (tasks.length === 0) {
      grid.innerHTML = ''
      emptyTasks.style.display = 'flex'
      return
    }
    emptyTasks.style.display = 'none'
    grid.innerHTML = tasks.map(renderCard).join('')
    bindCardEvents(tasks)
  }

  function renderCard(task) {
    const title = task.name || task.id
    const prompt = task.prompt || ''
    const preview = prompt.length > 140 ? prompt.slice(0, 140) + '…' : prompt
    return `
      <div class="cron-card" data-cron-id="${escHtml(task.id)}">
        <div class="cron-card-top">
          <label class="cron-toggle" data-stop>
            <input type="checkbox" ${task.enabled ? 'checked' : ''} data-action="toggle">
            <span class="cron-toggle-track"></span>
          </label>
          <button class="cron-card-menu" data-action="menu" aria-label="More">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>
          </button>
        </div>
        <div class="cron-card-body">
          <div class="cron-card-title">${escHtml(title)}</div>
          <div class="cron-card-desc">${escHtml(preview)}</div>
        </div>
        <div class="cron-card-footer">
          <div class="cron-card-schedule">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><polyline points="8,4 8,8 10.5,9.5"/></svg>
            <span>${escHtml(humanizeSchedule(task.schedule))}</span>
          </div>
        </div>
      </div>`
  }

  function bindCardEvents(tasks) {
    const byId = new Map(tasks.map(t => [t.id, t]))
    grid.querySelectorAll('.cron-card').forEach(card => {
      const id = card.dataset.cronId
      const task = byId.get(id)
      if (!task) return

      card.querySelector('[data-action="toggle"]')?.addEventListener('change', async (e) => {
        e.stopPropagation()
        await api.upsert({ ...task, enabled: e.target.checked, updatedAt: Date.now() })
        loadTasks()
      })

      card.querySelector('[data-action="menu"]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        showCardMenu(e.currentTarget, task)
      })

      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]') || e.target.closest('[data-stop]')) return
        openForm(task)
      })
    })
  }

  function showCardMenu(anchor, task) {
    document.querySelectorAll('.cron-popover').forEach(e => e.remove())
    const pop = document.createElement('div')
    pop.className = 'cron-popover'
    pop.innerHTML = `
      <button data-act="run">${t('cron_run_now', 'Run now')}</button>
      <button data-act="edit">${t('cron_edit', 'Edit')}</button>
      <button data-act="delete" class="cron-popover-danger">${t('delete_title', 'Delete')}</button>
    `
    document.body.appendChild(pop)
    const rect = anchor.getBoundingClientRect()
    pop.style.top = `${rect.bottom + 4}px`
    pop.style.left = `${rect.right - pop.offsetWidth}px`

    const closeMenu = () => { pop.remove(); document.removeEventListener('click', closeMenu) }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)

    pop.querySelector('[data-act="run"]').addEventListener('click', async (e) => {
      e.stopPropagation(); closeMenu()
      const res = await api.runNow(task.id)
      if (!res?.ok) {
        const already = /already running/i.test(res?.error || '')
        window.showToast?.(already
          ? t('cron_run_already', 'Task is already running')
          : t('cron_run_failed', 'Could not start task'))
        return
      }
      window.showToast?.(t('cron_run_started', 'Task started'))
      // Keep the user on the cron management page. Just surface the new run
      // in the sidebar (expand this task, refresh its runs) so they see the
      // pulsing blue dot appear. They can click it themselves if they want
      // to watch the stream.
      window.surfaceCronRunInSidebar?.(task.id)
      // Also refresh the Run History tab so the new row appears if user
      // flips over.
      setTimeout(() => loadRuns(), 800)
    })
    pop.querySelector('[data-act="edit"]').addEventListener('click', (e) => {
      e.stopPropagation(); closeMenu(); openForm(task)
    })
    pop.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation(); closeMenu()
      if (!(await window.klausDialog.confirm({
        message: t('cron_delete_confirm', 'Delete this task?'),
        danger: true,
      }))) return
      await api.delete(task.id)
      // refreshAll covers both tasks grid + runs list (cascade just nuked
      // this task's run rows, the Run History tab needs to reflect that).
      refreshAll()
    })
  }

  // ---- Run history pane ----
  function populateRunsTaskFilter(tasks) {
    const prev = runsTaskFilter.getValue()
    const items = [
      { value: '', i18nKey: 'cron_task_all' },
      ...tasks.map(x => ({ value: x.id, label: x.name || x.id })),
    ]
    const keep = prev && tasks.some(x => x.id === prev) ? prev : ''
    runsTaskFilter.setItems(items, { value: keep })
  }

  async function loadRuns() {
    const filters = { limit: 300 }
    const tid = runsTaskFilter.getValue()
    const st = runsStatusFilter.getValue()
    if (tid) filters.taskId = tid
    if (st) filters.status = st
    const runs = (await api.runs(filters)) || []
    renderRuns(runs)
  }

  function renderRuns(runs) {
    if (runs.length === 0) {
      runsList.innerHTML = ''
      emptyRuns.style.display = 'flex'
      return
    }
    emptyRuns.style.display = 'none'

    // Group by day (yyyy-mm-dd of startedAt)
    const groups = new Map() // key: yyyy-mm-dd → { label, rows }
    for (const r of runs) {
      const d = new Date(r.startedAt)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      if (!groups.has(key)) groups.set(key, { date: d, rows: [] })
      groups.get(key).rows.push(r)
    }

    const today = startOfDay(new Date()).getTime()
    const yesterday = today - 24 * 60 * 60 * 1000

    let html = ''
    for (const [key, g] of groups) {
      const dayMs = startOfDay(g.date).getTime()
      let label
      if (dayMs === today) label = t('cron_today', 'Today')
      else if (dayMs === yesterday) label = t('cron_yesterday', 'Yesterday')
      else label = `${g.date.getMonth() + 1}${t('cron_month', '月')}${g.date.getDate()}${t('cron_day', '日')}`

      html += `
        <div class="cron-runs-group">
          <div class="cron-runs-group-header">
            <span class="cron-runs-group-dot"></span>
            <span class="cron-runs-group-label">${escHtml(label)}</span>
          </div>
          <div class="cron-runs-group-list">
            ${g.rows.map(renderRunRow).join('')}
          </div>
        </div>`
    }
    runsList.innerHTML = html
  }

  function renderRunRow(r) {
    const time = formatTime(r.startedAt)
    const duration = r.durationMs != null
      ? (r.durationMs >= 1000 ? (r.durationMs / 1000).toFixed(1) + 's' : r.durationMs + 'ms')
      : '—'
    const triggerLabel = r.triggerType === 'manual'
      ? t('cron_trigger_manual', 'Manual')
      : t('cron_trigger_scheduled', 'Scheduled')
    let statusLabel
    if (r.status === 'success') statusLabel = `<span class="cron-run-status-success">${t('cron_status_success', 'Success')}</span>`
    else if (r.status === 'failed') statusLabel = `<span class="cron-run-status-failed">${t('cron_status_failed', 'Failed')}</span>`
    else statusLabel = `<span class="cron-run-status-badge">${t('cron_status_running', 'Running')}</span>`
    const errHtml = r.error ? `<span class="cron-run-error">${escHtml(r.error)}</span>` : ''
    return `
      <div class="cron-run-row status-${escHtml(r.status)}">
        <div class="cron-run-title">${escHtml(r.taskName || r.taskId)}</div>
        <div class="cron-run-meta">
          <span>${escHtml(time)}</span>
          <span>${escHtml(duration)}</span>
          <span>${escHtml(triggerLabel)}</span>
          ${statusLabel}
        </div>
        ${errHtml}
      </div>`
  }

  // ---- Form ----
  // Compile the picker state into a cron expression (or null when the caller
  // should use the raw `custom` input verbatim). One-shot collapses into a
  // specific-date cron that fires once per year; the scheduler+store handle
  // the self-delete after the first execution so it never fires again.
  function compileSchedule(state) {
    const { freq, hour, minute, weekday, monthday, interval, isoDate } = state
    switch (freq) {
      case 'oneshot': {
        if (!isoDate) return null
        const [, m, d] = isoDate.split('-').map(Number)
        return `${Number(minute) || 0} ${Number(hour) || 0} ${d} ${m} *`
      }
      case 'interval': {
        const n = Math.max(1, Math.min(59, Number(interval) || 30))
        return `*/${n} * * * *`
      }
      case 'hourly': return `0 * * * *`
      case 'daily': return `${Number(minute) || 0} ${Number(hour) || 0} * * *`
      case 'weekly': return `${Number(minute) || 0} ${Number(hour) || 0} * * ${weekday ?? '1'}`
      case 'monthly': return `${Number(minute) || 0} ${Number(hour) || 0} ${monthday ?? '1'} * *`
      default: return null
    }
  }

  // Decompose a stored cron back into picker state. Everything that doesn't
  // fit a preset falls through to 'custom' so the raw cron stays editable.
  function parseSchedule(cron, deleteAfterRun) {
    if (!cron || typeof cron !== 'string') return null
    const parts = cron.trim().split(/\s+/)
    if (parts.length !== 5) return null
    const [min, hour, dom, mon, dow] = parts
    const isNum = (s) => /^\d+$/.test(s)

    // Interval: */N * * * *
    const intMatch = min.match(/^\*\/(\d+)$/)
    if (intMatch && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return { freq: 'interval', interval: intMatch[1] }
    }

    // Hourly: 0 * * * *
    if (isNum(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return { freq: 'hourly' }
    }

    if (!isNum(min) || !isNum(hour)) return null
    const baseTime = { hour: String(Number(hour)), minute: String(Number(min)) }

    // One-shot: M H D Mo * (day and month both numeric), flagged as delete-after-run
    if (isNum(dom) && isNum(mon) && dow === '*' && deleteAfterRun) {
      // Infer the year: pick the next upcoming occurrence at or after today.
      const today = new Date()
      const m = Number(mon), d = Number(dom)
      let y = today.getFullYear()
      const trial = new Date(y, m - 1, d, Number(hour), Number(min))
      if (trial.getTime() < today.getTime()) y++
      return { ...baseTime, freq: 'oneshot', isoDate: `${y}-${pad2(m)}-${pad2(d)}` }
    }

    if (dom === '*' && mon === '*') {
      if (dow === '*') return { ...baseTime, freq: 'daily' }
      if (/^[0-6]$/.test(dow)) return { ...baseTime, freq: 'weekly', weekday: dow }
    }
    if (isNum(dom) && mon === '*' && dow === '*') {
      return { ...baseTime, freq: 'monthly', monthday: String(Number(dom)) }
    }
    return null
  }

  // Toggle secondary controls based on the selected frequency mode.
  function setMode(freq) {
    fDate.hidden = freq !== 'oneshot'
    fWeekday.hidden = freq !== 'weekly'
    fMonthday.hidden = freq !== 'monthly'
    fIntervalWrap.hidden = freq !== 'interval'
    fSchedule.hidden = freq !== 'custom'
    fScheduleHint.hidden = freq !== 'custom'
    fTzRow.hidden = freq !== 'custom'
    // Time picker is meaningless for interval / hourly / custom.
    fTime.hidden = freq === 'interval' || freq === 'hourly' || freq === 'custom'
  }

  function openForm(task) {
    editingId = task?.id ?? null
    modalTitle.textContent = editingId ? t('cron_edit', 'Edit task') : t('cron_new', 'New task')
    fName.value = task?.name ?? ''
    fPrompt.value = task?.prompt ?? ''
    fTimezone.value = task?.timezone ?? ''

    // Defaults
    ddWeekday.setValue('1')
    ddMonthday.setValue('1')
    fInterval.value = '30'
    fSchedule.value = ''

    const parsed = parseSchedule(task?.schedule, !!task?.deleteAfterRun)
    if (parsed) {
      ddFreq.setValue(parsed.freq)
      setTimeValue(parsed.hour ?? 9, parsed.minute ?? 0)
      if (parsed.weekday) ddWeekday.setValue(parsed.weekday)
      if (parsed.monthday) ddMonthday.setValue(parsed.monthday)
      if (parsed.interval) fInterval.value = parsed.interval
      if (parsed.isoDate) setDateValue(parsed.isoDate)
      else setDateValue(defaultIsoToday())
    } else if (task?.schedule) {
      ddFreq.setValue('custom')
      setTimeValue(9, 0)
      fSchedule.value = task.schedule
      setDateValue(defaultIsoToday())
    } else {
      ddFreq.setValue('daily')
      setTimeValue(9, 0)
      setDateValue(defaultIsoToday())
    }
    setMode(ddFreq.getValue())

    modal.classList.add('active')
    setTimeout(() => fName.focus(), 50)
  }
  function defaultIsoToday() {
    const d = new Date()
    return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
  }
  function closeForm() {
    modal.classList.remove('active')
    editingId = null
  }
  async function saveForm() {
    const name = fName.value.trim()
    const prompt = fPrompt.value.trim()
    const freq = ddFreq.getValue()
    const isCustom = freq === 'custom'
    const isOneShot = freq === 'oneshot'

    if (isOneShot && !fDate.dataset.value) {
      await window.klausDialog.alert(t('cron_form_date_required', 'Please pick a date for the one-shot task.'))
      return
    }

    const schedule = isCustom
      ? fSchedule.value.trim()
      : compileSchedule({
          freq,
          hour: fTime.dataset.hour,
          minute: fTime.dataset.minute,
          weekday: ddWeekday.getValue(),
          monthday: ddMonthday.getValue(),
          interval: fInterval.value,
          isoDate: fDate.dataset.value,
        })

    if (!schedule || !prompt) {
      await window.klausDialog.alert(t('cron_fields_required', 'Schedule and prompt are required.'))
      return
    }
    if (isCustom && schedule.split(/\s+/).length !== 5) {
      await window.klausDialog.alert(t('cron_form_schedule_invalid', 'Please enter a valid cron expression (5 fields).'))
      return
    }

    const now = Date.now()
    const id = editingId ?? ('task-' + now.toString(36))
    const tz = isCustom ? fTimezone.value.trim() : ''
    await api.upsert({
      id,
      name: name || undefined,
      schedule,
      prompt,
      enabled: true,
      deleteAfterRun: isOneShot,
      timezone: tz || undefined,
      createdAt: editingId ? undefined : now,
      updatedAt: now,
    })
    closeForm()
    loadTasks()
  }

  // ---- "Create via Klaus" — seed the chat input with a guiding prompt ----
  function createViaKlaus() {
    hide()
    const seed = t('cron_via_klaus_seed',
      'I want to create a scheduled task. Run [task] every [interval].')
    // Land on a fresh chat with the prompt pre-filled
    const startFresh = async () => {
      try {
        if (typeof window.hideCronView === 'function') window.hideCronView()
        const btn = document.getElementById('btn-new-chat')
        btn?.click()
      } catch {}
      // Fill the input after DOM has caught up
      setTimeout(() => {
        const inp = document.getElementById('input')
        if (inp) {
          inp.value = seed
          inp.dispatchEvent(new Event('input'))
          inp.focus()
        }
      }, 100)
    }
    startFresh()
  }

  // ---- Helpers ----
  function pad(n) { return String(n).padStart(2, '0') }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  function formatTime(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
  function escHtml(s) {
    return s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : ''
  }

  function humanizeSchedule(cron) {
    if (!cron || typeof cron !== 'string') return ''
    const parts = cron.trim().split(/\s+/)
    if (parts.length !== 5) return cron
    const [min, hour, dom, mon, dow] = parts
    const isInt = (s) => /^\d+$/.test(s)

    // Interval: */N * * * *
    const intMatch = min.match(/^\*\/(\d+)$/)
    if (intMatch && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return `${t('cron_freq_interval', 'Every ')} ${intMatch[1]} ${t('cron_unit_minutes', 'min')}`
    }

    // Hourly: M * * * *
    if (isInt(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return min === '0' ? t('cron_freq_hourly', 'Hourly') : `${t('cron_freq_hourly', 'Hourly')} :${pad(min)}`
    }

    const timeStr = isInt(hour) && isInt(min) ? `${pad(hour)}:${pad(min)}` : null
    if (timeStr && dom === '*' && mon === '*') {
      if (dow === '*') return `${t('cron_every_day', 'Daily')} ${timeStr}`
      if (dow === '1-5') return `${t('cron_weekdays', 'Weekdays')} ${timeStr}`
      if (dow === '0,6' || dow === '6,0') return `${t('cron_weekends', 'Weekends')} ${timeStr}`
      const names = {
        '0': t('cron_sunday', 'Sunday'), '1': t('cron_monday', 'Monday'),
        '2': t('cron_tuesday', 'Tuesday'), '3': t('cron_wednesday', 'Wednesday'),
        '4': t('cron_thursday', 'Thursday'), '5': t('cron_friday', 'Friday'),
        '6': t('cron_saturday', 'Saturday'),
      }
      if (isInt(dow) && names[dow]) return `${t('cron_every', 'Every ')}${names[dow]} ${timeStr}`
    }

    // Monthly: M H D * *
    if (timeStr && isInt(dom) && mon === '*' && dow === '*') {
      return `${t('cron_monthly', 'Monthly')} · ${dom} · ${timeStr}`
    }

    // One-shot / yearly: M H D Mo *
    if (timeStr && isInt(dom) && isInt(mon) && dow === '*') {
      return `${mon}/${dom} ${timeStr}`
    }

    return cron
  }

  // ---- Wire events ----
  refreshBtn?.addEventListener('click', () => { spinRefresh(); refreshAll() })
  newBtn?.addEventListener('click', () => openForm(null))
  viaKlausBtn?.addEventListener('click', createViaKlaus)
  tabs.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.cronTab)))
  // cron-sort change is wired via klsSelect.bind above — no addEventListener here.
  // runs task/status changes are wired via klsSelect.bind onChange above.

  modalClose?.addEventListener('click', closeForm)
  modalBackdrop?.addEventListener('click', closeForm)
  cancelBtn?.addEventListener('click', closeForm)
  saveBtn?.addEventListener('click', saveForm)
  // Popups are position:fixed, so they can't follow internal modal scroll —
  // close them all when the modal body scrolls so they don't float off anchor.
  document.querySelector('.cron-modal-body')?.addEventListener('scroll', () => closeAllPopups(null))
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeForm()
  })

  // Exports
  window.showCronView = show
  window.hideCronView = hide
  window.toggleCronView = () => (cronVisible ? hide() : show())
})()
