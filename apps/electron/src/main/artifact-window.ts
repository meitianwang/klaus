import { BrowserWindow } from 'electron'
import { join, basename } from 'path'

const APP_ROOT = join(__dirname, '../..')

// Reuse one window per filePath — re-clicking the same artifact focuses the
// existing window rather than spawning duplicates.
const windows = new Map<string, BrowserWindow>()

export function openArtifactWindow(sessionId: string, filePath: string): void {
  if (!filePath) return
  const existing = windows.get(filePath)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 480,
    minHeight: 320,
    title: basename(filePath),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Pass sessionId + filePath via query string — read by renderer/js/artifact.js.
  const search = `sessionId=${encodeURIComponent(sessionId)}&filePath=${encodeURIComponent(filePath)}`
  win.loadFile(join(APP_ROOT, 'src/renderer/artifact.html'), { search })

  windows.set(filePath, win)
  win.on('closed', () => { windows.delete(filePath) })
}
