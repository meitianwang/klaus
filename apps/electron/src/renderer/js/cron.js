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
  const sortSelect = document.getElementById('cron-sort')
  const runsTaskFilter = document.getElementById('cron-runs-task')
  const runsStatusFilter = document.getElementById('cron-runs-status')
  const grid = document.getElementById('cron-grid')
  const emptyTasks = document.getElementById('cron-empty')
  const runsList = document.getElementById('cron-runs-list')
  const emptyRuns = document.getElementById('cron-runs-empty')

  const modal = document.getElementById('cron-modal')
  const modalBackdrop = document.getElementById('cron-modal-backdrop')
  const modalTitle = document.getElementById('cron-modal-title')
  const modalClose = document.getElementById('cron-modal-close')
  const fName = document.getElementById('cron-form-name')
  const fSchedule = document.getElementById('cron-form-schedule')
  const fPrompt = document.getElementById('cron-form-prompt')
  const saveBtn = document.getElementById('cron-form-save')
  const cancelBtn = document.getElementById('cron-form-cancel')

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
      if (res?.ok) {
        // After a short delay, refresh runs so the new row appears
        setTimeout(() => loadRuns(), 800)
      } else {
        await window.klausDialog.alert(t('cron_run_failed', 'Could not start task') + ': ' + (res?.error || ''))
      }
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
      loadTasks()
    })
  }

  // ---- Run history pane ----
  function populateRunsTaskFilter(tasks) {
    const prev = runsTaskFilter.value
    runsTaskFilter.innerHTML =
      `<option value="">${t('cron_task_all', 'All tasks')}</option>` +
      tasks.map(x => `<option value="${escHtml(x.id)}">${escHtml(x.name || x.id)}</option>`).join('')
    if (prev && tasks.some(x => x.id === prev)) runsTaskFilter.value = prev
  }

  async function loadRuns() {
    const filters = { limit: 300 }
    if (runsTaskFilter.value) filters.taskId = runsTaskFilter.value
    if (runsStatusFilter.value) filters.status = runsStatusFilter.value
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
  function openForm(task) {
    editingId = task?.id ?? null
    modalTitle.textContent = editingId ? t('cron_edit', 'Edit task') : t('cron_new', 'New task')
    fName.value = task?.name ?? ''
    fSchedule.value = task?.schedule ?? ''
    fPrompt.value = task?.prompt ?? ''
    modal.classList.add('active')
    setTimeout(() => fName.focus(), 50)
  }
  function closeForm() {
    modal.classList.remove('active')
    editingId = null
  }
  async function saveForm() {
    const name = fName.value.trim()
    const schedule = fSchedule.value.trim()
    const prompt = fPrompt.value.trim()
    if (!schedule || !prompt) {
      await window.klausDialog.alert(t('cron_fields_required', 'Schedule and prompt are required.'))
      return
    }
    const now = Date.now()
    const id = editingId ?? ('task-' + now.toString(36))
    await api.upsert({
      id,
      name: name || undefined,
      schedule,
      prompt,
      enabled: true,
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
      'I want to create a scheduled task. Please help me work out:\n' +
      '1. What the task should do (the content you want Klaus to run)\n' +
      '2. How often it should run (daily / weekly / weekdays / a specific time)\n' +
      '3. A short name for it\n' +
      'Then confirm the details and I\'ll add it on the Scheduled Tasks page.')
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
    return cron
  }

  // ---- Wire events ----
  refreshBtn?.addEventListener('click', () => { spinRefresh(); refreshAll() })
  newBtn?.addEventListener('click', () => openForm(null))
  viaKlausBtn?.addEventListener('click', createViaKlaus)
  tabs.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.cronTab)))
  sortSelect?.addEventListener('change', () => { currentSort = sortSelect.value; renderTasks() })
  runsTaskFilter?.addEventListener('change', loadRuns)
  runsStatusFilter?.addEventListener('change', loadRuns)

  modalClose?.addEventListener('click', closeForm)
  modalBackdrop?.addEventListener('click', closeForm)
  cancelBtn?.addEventListener('click', closeForm)
  saveBtn?.addEventListener('click', saveForm)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeForm()
  })

  // Exports
  window.showCronView = show
  window.hideCronView = hide
  window.toggleCronView = () => (cronVisible ? hide() : show())
})()
