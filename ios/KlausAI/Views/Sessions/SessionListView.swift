import SwiftUI

/// Sidebar view listing all chat sessions (Gemini-style).
struct SessionListView: View {
    @ObservedObject var sessionVM: SessionListViewModel
    @ObservedObject var chatVM: ChatViewModel
    @Binding var selectedSessionId: String?
    @EnvironmentObject private var appState: AppState
    @State private var searchText = ""

    var body: some View {
        List(selection: $selectedSessionId) {
            // Search bar
            Section {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField(L10n.searchConversations, text: $searchText)
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }

            // New chat button
            Section {
                Button {
                    withAnimation {
                        chatVM.newSession()
                        selectedSessionId = chatVM.currentSessionId
                    }
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 20))
                            .foregroundStyle(.primary)
                        
                        Text("发起新对话")
                            .font(.system(.body, design: .default, weight: .semibold))
                            .foregroundStyle(.primary)
                        
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            // Session list
            Section {
                if sessionVM.sessions.isEmpty && !sessionVM.isLoading {
                    EmptyStateView(
                        title: L10n.noConversations,
                        systemImage: "bubble.left.and.bubble.right",
                        description: L10n.startNewChat
                    )
                    .padding(.top, 40)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }

                ForEach(filteredSessions) { session in
                    SessionRow(session: session, isActive: session.sessionId == chatVM.currentSessionId)
                        .tag(session.sessionId)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
                .onDelete { indexSet in
                    let sessions = filteredSessions
                    Task {
                        for index in indexSet {
                            let session = sessions[index]
                            await sessionVM.deleteSession(session.sessionId)
                        }
                    }
                }
            } header: {
                Text(L10n.conversations)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .textCase(nil)
            }
        }
        .listStyle(.plain)
        .onChange(of: selectedSessionId) { newValue in
            guard let sessionId = newValue else { return }
            let title = sessionVM.sessions.first(where: { $0.sessionId == sessionId })?.title
            Task {
                await chatVM.switchSession(sessionId, title: title)
            }
            HapticManager.selection()
        }
        .refreshable {
            await sessionVM.loadSessions()
        }
        .task {
            await sessionVM.loadSessions()
        }
        .overlay {
            if sessionVM.isLoading && sessionVM.sessions.isEmpty {
                ProgressView()
            }
        }
    }

    private var filteredSessions: [SessionSummary] {
        if searchText.isEmpty {
            return sessionVM.sessions
        }
        return sessionVM.sessions.filter {
            $0.title.localizedCaseInsensitiveContains(searchText)
        }
    }
}
