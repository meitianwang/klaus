import Foundation

// MARK: - Identifiers

let appBundleId = "ai.klaus.mac"

// MARK: - Defaults Keys

let pauseEnabledKey = "klaus.pauseEnabled"
let showDockIconKey = "klaus.showDockIcon"
let onboardingSeenKey = "klaus.onboardingSeen"
let debugPaneEnabledKey = "klaus.debugPaneEnabled"
let voiceWakeEnabledKey = "klaus.voiceWakeEnabled"
let talkEnabledKey = "klaus.talkEnabled"
let canvasEnabledKey = "klaus.canvasEnabled"
let peekabooBridgeEnabledKey = "klaus.peekabooBridgeEnabled"

// MARK: - Engine

let engineStartTimeoutSeconds: TimeInterval = 30
let engineModelOverrideKey = "klaus.engineModelOverride"
let engineWorkingDirKey = "klaus.engineWorkingDir"
let enginePermissionModeKey = "klaus.enginePermissionMode"

// MARK: - Voice Wake

let defaultVoiceWakeTriggers = ["klaus"]
let voiceWakeMaxWords = 32
