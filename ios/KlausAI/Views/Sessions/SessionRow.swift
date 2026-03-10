import SwiftUI

/// A single row in the session list, showing title from first message.
struct SessionRow: View {
    let session: SessionSummary
    let isActive: Bool

    var body: some View {
        HStack(spacing: 16) {
            // Icon
            Image(systemName: isActive ? "bubble.left.fill" : "bubble.left")
                .font(.system(size: 20))
                .foregroundStyle(isActive ? Color.primary : Color.secondary)
                .frame(width: 36, height: 36)

            // Texts
            VStack(alignment: .leading, spacing: 4) {
                Text(displayTitle)
                    .font(.system(.body, design: .default, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text("\(session.messageCount) 条消息")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Text(session.updatedDate.relativeString)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isActive ? Color(.systemGray6) : Color.clear)
        )
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
