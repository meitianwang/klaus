import AppKit
import Foundation
import MenuBarExtraAccess
import OSLog
import SwiftUI

@main
struct KlausApp: App {
    @NSApplicationDelegateAdaptor(KlausAppDelegate.self) private var delegate
    @State private var state = AppState.shared
    private let engine = EngineProcess.shared
    @State private var isMenuPresented = false

    private static let logger = Logger(subsystem: "ai.klaus", category: "app")

    init() {
        EngineEnvironment.shared.refresh()
    }

    var body: some Scene {
        MenuBarExtra {
            MenuContentView(state: state, engine: engine)
        } label: {
            AnimatedStatusIcon(
                status: engine.status,
                isPaused: state.isPaused,
                isWorking: state.isWorking
            )
        }
        .menuBarExtraStyle(.menu)
        .menuBarExtraAccess(isPresented: $isMenuPresented)
        .onChange(of: state.isPaused) { _, paused in
            if paused {
                engine.stop()
            } else {
                engine.start()
            }
        }

        Settings {
            SettingsRootView(state: state)
                .frame(width: 600, height: 520)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Chat") {
                    WebChatManager.shared.show()
                }
                .keyboardShortcut("n")

                Button("Toggle Chat Panel") {
                    WebChatManager.shared.toggle()
                }
                .keyboardShortcut("o")
            }

            CommandGroup(after: .sidebar) {
                Button("Interrupt") {
                    EngineProcess.shared.interrupt()
                }
                .keyboardShortcut(".", modifiers: [.command])
            }
        }
    }
}

// MARK: - App Delegate

final class KlausAppDelegate: NSObject, NSApplicationDelegate {
    private static let logger = Logger(subsystem: "ai.klaus", category: "delegate")

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !AppState.shared.showDockIcon {
            NSApplication.shared.setActivationPolicy(.accessory)
        }

        // Attach permission prompt controller
        PermissionPromptController.shared.attach()

        // Start engine if not paused
        if !AppState.shared.isPaused {
            let model = AppState.shared.modelOverride.isEmpty ? nil : AppState.shared.modelOverride
            let cwd = AppState.shared.workingDirectory.isEmpty ? nil : AppState.shared.workingDirectory
            let perm = AppState.shared.permissionMode
            EngineProcess.shared.start(cwd: cwd, modelOverride: model, permissionMode: perm)
        }

        // Start subsystems
        CanvasA2UIBridge.shared.startListening()
        ConfigFileWatcher.shared.start()
        ConfigFileWatcher.shared.onChange = {
            EngineEnvironment.shared.refresh()
        }
        OnboardingController.shared.showIfNeeded()

        // Start voice wake if enabled
        if AppState.shared.voiceWakeEnabled {
            Task { await VoiceWakeRuntime.shared.start() }
        }

        // Start Peekaboo bridge if enabled
        if AppState.shared.peekabooBridgeEnabled {
            Task { await PeekabooBridgeHostCoordinator.shared.setEnabled(true) }
        }

        // Start push-to-talk if accessibility is granted
        if PermissionManager.shared.check(.accessibility) == .granted {
            VoicePushToTalk.shared.start()
        }

        Self.logger.info("Klaus macOS app launched (engine mode)")
    }

    func applicationWillTerminate(_ notification: Notification) {
        EngineProcess.shared.stop()
        ConfigFileWatcher.shared.stop()
        VoicePushToTalk.shared.stop()
        Task { await PeekabooBridgeHostCoordinator.shared.stop() }
        Task { await VoiceWakeRuntime.shared.stop() }
        Self.logger.info("Klaus macOS app terminating")
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            DeepLinkHandler.shared.handle(url: url)
        }
    }
}
