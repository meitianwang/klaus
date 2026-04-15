import AppKit
import SwiftUI

/// Manages the Chat panel/window lifecycle.
/// Previously used WKWebView to load daemon's web UI; now hosts NativeChatView directly.
@MainActor
final class WebChatManager {
    static let shared = WebChatManager()

    private var panel: NativeChatPanel?
    var onPanelVisibilityChanged: ((Bool) -> Void)?

    func toggle(anchorFrame: NSRect? = nil) {
        if let panel, panel.isVisible {
            hide()
        } else {
            show(anchorFrame: anchorFrame)
        }
    }

    func show(anchorFrame: NSRect? = nil) {
        if panel == nil {
            panel = NativeChatPanel()
        }
        guard let panel else { return }

        // Position below the menu bar icon if anchor provided
        if let anchor = anchorFrame {
            let panelSize = NSSize(width: 800, height: 640)
            let x = anchor.midX - panelSize.width / 2
            let y = anchor.minY - panelSize.height - 4
            panel.setFrame(NSRect(origin: NSPoint(x: x, y: y), size: panelSize), display: true)
        }

        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        onPanelVisibilityChanged?(true)
    }

    func hide() {
        panel?.orderOut(nil)
        onPanelVisibilityChanged?(false)
    }

    var isVisible: Bool {
        panel?.isVisible ?? false
    }
}

// MARK: - Native Chat Panel (NSPanel hosting SwiftUI)

final class NativeChatPanel: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 640),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        title = "Klaus Chat"
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isMovableByWindowBackground = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
        minSize = NSSize(width: 560, height: 400)

        let hostingView = NSHostingView(rootView: NativeChatView())
        contentView = hostingView
    }

    override func close() {
        orderOut(nil)
        WebChatManager.shared.onPanelVisibilityChanged?(false)
    }
}
