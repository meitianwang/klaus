import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { showMainWindow, getMainWindow } from './window.js'

const APP_ROOT = join(__dirname, '../..')

let tray: Tray | null = null

export function createTray(): void {
  const iconPath = join(APP_ROOT, 'resources/tray-icon.png')
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    icon.setTemplateImage(true)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Klaus')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'New Chat', click: () => {
      showMainWindow()
      getMainWindow()?.webContents.send('tray:new-chat')
    }},
    { label: 'Show Klaus', click: showMainWindow },
    { type: 'separator' },
    { label: 'Settings', click: () => {
      showMainWindow()
      getMainWindow()?.webContents.send('tray:open-settings')
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', showMainWindow)
}
