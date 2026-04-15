import AppKit
import Foundation
import OSLog

/// Handles tool permission requests from the CC engine via the control_request protocol.
/// Replaces ExecApprovalsSocket — instead of Unix socket, listens to EngineProcess stdout events.
@MainActor
final class PermissionPromptController {
    static let shared = PermissionPromptController()

    private let logger = Logger(subsystem: "ai.klaus", category: "permissions")
    private var pendingQueue: [ControlRequestMessage] = []
    private var isPrompting = false
    private let timeoutSeconds: TimeInterval = 120

    /// Wire up to EngineProcess. Call once at startup.
    func attach() {
        EngineProcess.shared.onPermissionRequest = { [weak self] request in
            self?.enqueue(request)
        }
    }

    // MARK: - Queue Management

    private func enqueue(_ request: ControlRequestMessage) {
        pendingQueue.append(request)
        if !isPrompting {
            processNext()
        }
    }

    private func processNext() {
        guard !pendingQueue.isEmpty else {
            isPrompting = false
            return
        }

        isPrompting = true
        let request = pendingQueue.removeFirst()
        showPrompt(for: request)
    }

    // MARK: - NSAlert Prompt

    private func showPrompt(for request: ControlRequestMessage) {
        let toolName = request.request.display_name ?? request.request.tool_name ?? "Unknown Tool"
        let description = formatDescription(request.request)

        let alert = NSAlert()
        alert.messageText = "\(L10n.permissionRequest): \(toolName)"
        alert.informativeText = description
        alert.alertStyle = .warning

        alert.addButton(withTitle: L10n.allowOnce)
        alert.addButton(withTitle: L10n.alwaysAllow)
        alert.addButton(withTitle: L10n.deny)

        // Bring app to front for the alert
        NSApp.activate(ignoringOtherApps: true)

        // Timeout task
        let requestId = request.request_id
        let timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(self?.timeoutSeconds ?? 120))
            await MainActor.run {
                // If still prompting for this request, auto-deny
                self?.logger.warning("Permission request \(requestId) timed out, auto-denying")
            }
        }

        let response = alert.runModal()
        timeoutTask.cancel()

        switch response {
        case .alertFirstButtonReturn:
            // Allow Once
            logger.info("Allowed once: \(toolName)")
            EngineProcess.shared.allowTool(requestId: requestId, permanently: false)

        case .alertSecondButtonReturn:
            // Always Allow — pass permission_suggestions so CC persists the rule
            logger.info("Always allowed: \(toolName)")
            EngineProcess.shared.allowTool(
                requestId: requestId,
                permanently: true,
                suggestions: request.request.permission_suggestions
            )

        default:
            // Deny
            logger.info("Denied: \(toolName)")
            EngineProcess.shared.denyTool(requestId: requestId)
        }

        processNext()
    }

    // MARK: - Description Formatting

    private func formatDescription(_ request: ControlRequestInner) -> String {
        if let desc = request.description, !desc.isEmpty {
            return desc
        }

        let toolName = request.tool_name ?? ""
        let input = request.input ?? [:]

        switch toolName {
        case "Bash":
            if let command = input["command"]?.stringValue {
                let truncated = command.count > 500 ? String(command.prefix(500)) + "…" : command
                return "Run command:\n\n\(truncated)"
            }
        case "Write":
            if let path = input["file_path"]?.stringValue {
                return "Write file: \(path)"
            }
        case "Edit":
            if let path = input["file_path"]?.stringValue {
                return "Edit file: \(path)"
            }
        case "WebFetch":
            if let url = input["url"]?.stringValue {
                return "Fetch URL: \(url)"
            }
        default:
            break
        }

        // Fallback: show tool name + input keys
        let keys = input.keys.sorted().joined(separator: ", ")
        return "Tool: \(toolName)\nInput keys: \(keys)"
    }
}
