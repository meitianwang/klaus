import AppKit
import Foundation
import OSLog
import SwiftUI

// MARK: - Heartbeat Store

/// Tracks heartbeat events from the daemon via WebSocket push subscription.
@MainActor
@Observable
final class HeartbeatStore {
    static let shared = HeartbeatStore()

    private let logger = Logger(subsystem: "ai.klaus", category: "heartbeat")

    struct HeartbeatEvent: Sendable {
        let timestamp: Date
        let status: String
        let preview: String?
        let durationMs: Int?
        let hasMedia: Bool
    }

    private(set) var lastHeartbeat: HeartbeatEvent?
    private(set) var isReceiving = false
    private var subscriptionTask: Task<Void, Never>?

    func start() {
        guard subscriptionTask == nil else { return }
        // In engine mode, heartbeats are not needed — the engine process
        // lifecycle is directly managed. Keep the interface for compatibility.
        isReceiving = true
        logger.info("Heartbeat monitoring started (engine mode — no-op)")
    }

    func stop() {
        subscriptionTask?.cancel()
        subscriptionTask = nil
        isReceiving = false
    }

    private func handleHeartbeat(_ payload: [String: Any]) {
        lastHeartbeat = HeartbeatEvent(
            timestamp: Date(),
            status: payload["status"] as? String ?? "unknown",
            preview: payload["preview"] as? String,
            durationMs: payload["durationMs"] as? Int,
            hasMedia: payload["hasMedia"] as? Bool ?? false
        )
    }
}

// MARK: - Usage / Cost Tracking

@MainActor
@Observable
final class UsageCostStore {
    static let shared = UsageCostStore()

    private let logger = Logger(subsystem: "ai.klaus", category: "usage")

    struct UsageData: Sendable {
        var totalTokens: Int = 0
        var inputTokens: Int = 0
        var outputTokens: Int = 0
        var estimatedCostUSD: Double = 0
        var sessionCount: Int = 0
    }

    private(set) var usage = UsageData()

    func refresh() async {
        // In engine mode, usage data comes from the result message
        // which includes total_cost_usd. We don't poll a daemon endpoint.
        // Usage is tracked per-session by the engine.
    }
}

/// Menu bar usage display.
struct CostUsageMenuView: View {
    let usage: UsageCostStore.UsageData

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "chart.bar")
                    .foregroundStyle(.secondary)
                Text("Usage")
                    .font(.caption.bold())
            }
            if usage.totalTokens > 0 {
                Text("\(formatTokens(usage.totalTokens)) tokens")
                    .font(.caption)
                if usage.estimatedCostUSD > 0 {
                    Text("~$\(String(format: "%.4f", usage.estimatedCostUSD))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No usage data")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func formatTokens(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        } else if count >= 1_000 {
            return String(format: "%.1fK", Double(count) / 1_000)
        }
        return "\(count)"
    }
}

// MARK: - Animated Status Icon

// AnimatedStatusIcon is now defined in StatusIcon.swift

// MARK: - Canvas A2UI Bridge

/// Handles A2UI (Agent-to-UI) protocol messages between the daemon and Canvas WebView.
@MainActor
final class CanvasA2UIBridge {
    static let shared = CanvasA2UIBridge()

    private let logger = Logger(subsystem: "ai.klaus", category: "canvas.a2ui")

    /// Process an A2UI action from the WebView's JavaScript bridge.
    func handleAction(command: String, payload: [String: Any], sessionKey: String) async {
        logger.info("A2UI action: \(command, privacy: .public) session=\(sessionKey, privacy: .public)")

        switch command {
        case "navigate":
            if let url = payload["url"] as? String {
                CanvasManager.shared.show(sessionKey: sessionKey, htmlPath: url)
            }

        case "eval":
            if let js = payload["javascript"] as? String {
                _ = await CanvasManager.shared.eval(sessionKey: sessionKey, javaScript: js)
            }

        case "snapshot":
            if let outPath = payload["outPath"] as? String {
                let controller = CanvasManager.shared
                // Snapshot is handled by the controller
                logger.info("Snapshot requested to \(outPath, privacy: .public)")
            }

        case "present":
            let path = payload["path"] as? String
            CanvasManager.shared.show(sessionKey: sessionKey, htmlPath: path)

        case "hide":
            CanvasManager.shared.hide(sessionKey: sessionKey)

        case "resize":
            // Resize canvas window
            if let width = payload["width"] as? CGFloat,
               let height = payload["height"] as? CGFloat {
                logger.info("Resize canvas to \(width)x\(height)")
            }

        default:
            logger.warning("Unknown A2UI command: \(command, privacy: .public)")
        }
    }

    /// In engine mode, canvas events would come through the engine's stdout stream.
    /// For now, canvas actions are triggered by direct API calls from the engine.
    func startListening() {
        logger.info("Canvas A2UI bridge started (engine mode)")
    }
}
