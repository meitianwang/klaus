import SwiftUI

/// SF Symbol-based status icon for the menu bar.
struct StatusIcon: View {
    let status: EngineProcess.Status
    let isPaused: Bool

    var body: some View {
        Image(systemName: iconName)
            .foregroundStyle(iconColor)
    }

    private var iconName: String {
        if isPaused {
            return "pause.circle.fill"
        }
        switch status {
        case .idle:
            return "circle"
        case .starting:
            return "circle.dotted"
        case .running:
            return "circle.fill"
        case .stopping:
            return "circle.dotted"
        case .failed:
            return "exclamationmark.circle.fill"
        }
    }

    private var iconColor: Color {
        if isPaused {
            return .secondary
        }
        switch status {
        case .idle:
            return .secondary
        case .starting, .stopping:
            return .orange
        case .running:
            return .green
        case .failed:
            return .red
        }
    }
}

/// Animated wrapper for the menu bar icon.
struct AnimatedStatusIcon: View {
    let status: EngineProcess.Status
    let isPaused: Bool
    let isWorking: Bool

    var body: some View {
        StatusIcon(status: status, isPaused: isPaused)
    }
}
