import AppKit
import SwiftUI

/// Menu bar menu content — status, controls, quick actions.
struct MenuContentView: View {
    let state: AppState
    let engine: EngineProcess

    var body: some View {
        // Status header
        Section {
            Label {
                Text(engine.status.displayText)
            } icon: {
                StatusIcon(status: engine.status, isPaused: state.isPaused)
            }

            if let model = engine.model {
                Label {
                    Text(model)
                        .font(.caption)
                } icon: {
                    Image(systemName: "cpu")
                        .foregroundStyle(.secondary)
                }
            }
        }

        Divider()

        // Engine controls
        Section {
            if state.isPaused {
                Button(L10n.resume) {
                    state.isPaused = false
                    engine.start()
                }
            } else {
                Button(L10n.pause) {
                    state.isPaused = true
                    engine.stop()
                }
            }

            if !engine.status.isActive && !state.isPaused {
                Button(L10n.startEngine) {
                    engine.start()
                }
            }

            if engine.status.isActive {
                Button(L10n.restartEngine) {
                    engine.stop()
                    Task {
                        try? await Task.sleep(for: .milliseconds(500))
                        await MainActor.run { engine.start() }
                    }
                }

                Button(L10n.newSession) {
                    engine.stop()
                    Task {
                        try? await Task.sleep(for: .milliseconds(500))
                        await MainActor.run { engine.start() }
                    }
                }
            }
        }

        Divider()

        // Feature toggles
        Section {
            Toggle("Voice Wake", isOn: Binding(
                get: { state.voiceWakeEnabled },
                set: { newValue in
                    state.voiceWakeEnabled = newValue
                    Task {
                        if newValue {
                            await VoiceWakeRuntime.shared.start()
                        } else {
                            await VoiceWakeRuntime.shared.stop()
                        }
                    }
                }
            ))

            Toggle("Canvas", isOn: Binding(
                get: { state.canvasEnabled },
                set: { state.canvasEnabled = $0 }
            ))

            if state.talkEnabled {
                Button("Talk Mode") {
                    Task { await TalkModeRuntime.shared.start() }
                }
            }
        }

        Divider()

        // Quick actions
        Section {
            Button(L10n.openChatPanel) {
                WebChatManager.shared.show()
            }
            .keyboardShortcut("o")
        }

        // Usage
        if UsageCostStore.shared.usage.totalTokens > 0 {
            Divider()
            Section {
                CostUsageMenuView(usage: UsageCostStore.shared.usage)
            }
        }

        Divider()

        // App controls
        Section {
            SettingsLink {
                Text("Settings…")
            }
            .keyboardShortcut(",")

            Button(L10n.quitKlaus) {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }
}
