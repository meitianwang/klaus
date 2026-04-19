import { Notification } from 'electron'
import { getMainWindow } from './window.js'
import type { SettingsStore } from './settings-store.js'

/**
 * Triggers desktop notifications and sound cues for agent events.
 *
 * Skips notifications when the main window is focused (user is already there).
 * Each channel (desktop / sound) is gated by its own KV setting:
 *   - notification.desktop  → Electron Notification with silent: true
 *   - notification.sound    → IPC 'notify:sound' to the renderer for playback
 */
export class NotificationService {
  constructor(private store: SettingsStore) {}

  private windowFocused(): boolean {
    const win = getMainWindow()
    return !!win && !win.isMinimized() && win.isFocused()
  }
  private desktopOn(): boolean {
    return this.store.get('notification.desktop') !== 'off'
  }
  private soundOn(): boolean {
    return this.store.get('notification.sound') !== 'off'
  }

  notifyDone(body = 'Task completed'): void {
    if (this.windowFocused()) return
    if (this.desktopOn() && Notification.isSupported()) {
      try { new Notification({ title: 'Klaus', body, silent: true }).show() } catch {}
    }
    if (this.soundOn()) {
      getMainWindow()?.webContents.send('notify:sound', 'done')
    }
  }

  notifyNeedInput(body = 'Waiting for your approval'): void {
    if (this.windowFocused()) return
    if (this.desktopOn() && Notification.isSupported()) {
      try { new Notification({ title: 'Klaus', body, silent: true }).show() } catch {}
    }
    if (this.soundOn()) {
      getMainWindow()?.webContents.send('notify:sound', 'input')
    }
  }
}
