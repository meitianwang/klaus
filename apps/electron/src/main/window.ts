import { BrowserWindow, app } from 'electron'
import { join } from 'path'

// In CJS output, __dirname is available natively
// APP_ROOT = apps/electron/ (two levels up from dist/main/)
const APP_ROOT = join(__dirname, '../..')

let mainWindow: BrowserWindow | null = null

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load renderer — static HTML files from src/renderer
  mainWindow.loadFile(join(APP_ROOT, 'src/renderer/index.html'))

  // macOS: hide window instead of closing (keeps running in tray)
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}
