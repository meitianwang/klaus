import AppKit
import Foundation
import OSLog
import UserNotifications

/// Session data model for display in the menu and settings.
struct SessionInfo: Identifiable, Sendable {
    let id: String
    let sessionKey: String
    let model: String?
    let updatedAt: Date
}

/// Manages session state — single active session backed by the CC engine.
@MainActor
final class MenuSessionsInjector {
    static let shared = MenuSessionsInjector()

    private let logger = Logger(subsystem: "ai.klaus", category: "sessions")
    private(set) var sessions: [SessionInfo] = []

    /// Refresh session info from the engine process.
    func refresh() {
        let engine = EngineProcess.shared
        if let sid = engine.sessionId {
            sessions = [SessionInfo(
                id: sid,
                sessionKey: sid,
                model: engine.model,
                updatedAt: Date()
            )]
        } else {
            sessions = []
        }
    }

    /// Start a new session (restarts engine without --resume).
    func newSession() {
        EngineProcess.shared.stop()
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            await MainActor.run {
                EngineProcess.shared.start()
            }
        }
    }

    /// Resume a specific session.
    func resumeSession(_ sessionId: String) {
        EngineProcess.shared.stop()
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            await MainActor.run {
                EngineProcess.shared.start(resumeSessionId: sessionId)
            }
        }
    }
}

/// Manages macOS user notifications for task completion, errors, etc.
@MainActor
final class NotificationManager {
    static let shared = NotificationManager()

    private let logger = Logger(subsystem: "ai.klaus", category: "notifications")

    func send(title: String, body: String, sound: Bool = true) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if sound {
            content.sound = .default
        }

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                self.logger.error("Notification error: \(error.localizedDescription)")
            }
        }
    }
}

/// Show/hide the Dock icon.
@MainActor
final class DockIconManager {
    static let shared = DockIconManager()

    var isVisible: Bool {
        NSApp.activationPolicy() == .regular
    }

    func setVisible(_ visible: Bool) {
        if visible {
            NSApp.setActivationPolicy(.regular)
        } else {
            NSApp.setActivationPolicy(.accessory)
        }
    }
}

/// Handles `klaus://` deep links.
@MainActor
final class DeepLinkHandler {
    static let shared = DeepLinkHandler()

    private let logger = Logger(subsystem: "ai.klaus", category: "deeplinks")

    func handle(url: URL) {
        guard url.scheme == "klaus" else { return }

        let host = url.host ?? ""
        logger.info("Deep link: \(url.absoluteString, privacy: .public)")

        switch host {
        case "chat":
            WebChatManager.shared.show()
        case "settings":
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        case "canvas":
            let session = url.pathComponents.dropFirst().first ?? "default"
            CanvasManager.shared.show(sessionKey: session)
        default:
            logger.warning("Unknown deep link host: \(host)")
        }
    }
}
