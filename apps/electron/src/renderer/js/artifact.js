// Standalone artifact preview window. Loads file via klausApi.artifacts.read,
// renders markdown / source code, supports source/preview toggle.

const klausApi = window.klaus

const params = new URLSearchParams(window.location.search)
const sessionId = params.get('sessionId') || ''
const filePath = params.get('filePath') || ''

const FILE_TYPE_LABELS = {
  md: 'Markdown', markdown: 'Markdown',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust',
  java: 'Java', kt: 'Kotlin', swift: 'Swift',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++',
  cs: 'C#', php: 'PHP', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
  xml: 'XML', svg: 'SVG', sql: 'SQL', csv: 'CSV',
  txt: 'Text', log: 'Log', conf: 'Config', ini: 'Config', env: 'Config',
}
function fileTypeLabel(p) {
  const m = /\.([A-Za-z0-9]+)$/.exec(p || '')
  if (!m) return ''
  return FILE_TYPE_LABELS[m[1].toLowerCase()] || m[1].toUpperCase()
}
function fileBaseName(p) {
  if (!p) return ''
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}

const titleEl = document.getElementById('aw-title')
const filenameEl = document.getElementById('aw-filename')
const filetypeEl = document.getElementById('aw-filetype')
const bodyEl = document.getElementById('aw-body')
const truncEl = document.getElementById('aw-truncated')
const copyBtn = document.getElementById('aw-copy')
const folderBtn = document.getElementById('aw-folder')
const viewToggle = document.getElementById('aw-viewtoggle')
const viewSourceBtn = document.getElementById('aw-view-source')
const viewPreviewBtn = document.getElementById('aw-view-preview')

const baseName = fileBaseName(filePath)
const isMd = /\.(md|markdown)$/i.test(filePath)
let content = ''
let view = isMd ? 'preview' : 'source'

document.title = baseName
if (titleEl) titleEl.textContent = baseName
if (filenameEl) { filenameEl.textContent = baseName; filenameEl.title = filePath }
if (filetypeEl) filetypeEl.textContent = fileTypeLabel(filePath)
if (viewToggle) viewToggle.classList.toggle('is-hidden', !isMd)

function syncToggle() {
  if (viewSourceBtn) viewSourceBtn.classList.toggle('is-active', view === 'source')
  if (viewPreviewBtn) viewPreviewBtn.classList.toggle('is-active', view === 'preview')
}

function renderSource() {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = content
  pre.appendChild(code)
  bodyEl.innerHTML = ''
  bodyEl.appendChild(pre)
  if (typeof hljs !== 'undefined') {
    try { hljs.highlightElement(code) } catch {}
  }
}

function renderPreview() {
  if (isMd && typeof marked !== 'undefined') {
    bodyEl.innerHTML = marked.parse(content)
  } else {
    renderSource()
  }
}

function setView(next) {
  const target = isMd && next === 'preview' ? 'preview' : 'source'
  if (target === view) return
  view = target
  syncToggle()
  if (!content) return
  const scrollTop = bodyEl.scrollTop
  bodyEl.classList.add('is-swapping')
  setTimeout(() => {
    if (view === 'preview') renderPreview()
    else renderSource()
    bodyEl.scrollTop = scrollTop
    requestAnimationFrame(() => bodyEl.classList.remove('is-swapping'))
  }, 120)
}

viewSourceBtn?.addEventListener('click', () => setView('source'))
viewPreviewBtn?.addEventListener('click', () => setView('preview'))
copyBtn?.addEventListener('click', () => {
  if (!filePath) return
  navigator.clipboard?.writeText?.(filePath).catch(() => {})
})
folderBtn?.addEventListener('click', () => {
  if (filePath) klausApi?.artifacts?.reveal?.(filePath).catch(() => {})
  else if (sessionId) klausApi?.artifacts?.openWorkspace?.(sessionId).catch(() => {})
})
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); window.close() }
})

syncToggle()
bodyEl.textContent = 'Loading…'

;(async () => {
  try {
    const data = await klausApi.artifacts.read(sessionId, filePath)
    if (data?.error) {
      bodyEl.textContent = data.error === 'file not found' ? 'File no longer exists' : 'Failed to load file'
      return
    }
    content = data?.content || ''
    if (view === 'preview') renderPreview()
    else renderSource()
    truncEl.style.display = data?.truncated ? 'block' : 'none'
  } catch {
    bodyEl.textContent = 'Failed to load file'
  }
})()
