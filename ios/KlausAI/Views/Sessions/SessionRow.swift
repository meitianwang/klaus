import SwiftUI

/// A single row in the session list, showing title from first message.
struct SessionRow: View {
    let session: SessionSummary
    let isActive: Bool

    var body: some View {
        HStack {
            Text(displayTitle)
                .font(.system(.body, design: .default, weight: isActive ? .semibold : .regular))
                .foregroundStyle(.primary)
                .lineLimit(1)

            Spacer()
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 16)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isActive ? Color.brown.opacity(0.15) : Color.clear)
        )
        .contentShape(Rectangle())
    }

    /// Use session title (from first message) or fallback to "新对话"
    private var displayTitle: String {
        if session.title.isEmpty {
            return L10n.newChat
        }
        // Truncate long titles
        if session.title.count > 40 {
            return String(session.title.prefix(40)) + "..."
        }
        return session.title
    }

    /// Shorten model name for display
    private func modelShortName(_ model: String) -> String {
        if model.contains("opus") { return "Opus" }
        if model.contains("sonnet") { return "Sonnet" }
        if model.contains("haiku") { return "Haiku" }
        return model
    }
}
