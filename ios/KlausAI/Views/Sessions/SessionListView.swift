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
            // Upper menu
            Section {
                VStack(spacing: 20) {
                    Button {
                        withAnimation {
                            chatVM.newSession()
                            selectedSessionId = chatVM.currentSessionId
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "plus")
                                .font(.system(size: 16))
                                .foregroundStyle(.secondary)
                            Text("新任务")
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Button { } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "wrench.and.screwdriver")
                                .font(.system(size: 16))
                                .foregroundStyle(.secondary)
                            Text("技能")
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Button { } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "clock")
                                .font(.system(size: 16))
                                .foregroundStyle(.secondary)
                            Text("定时任务")
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Button { } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "bubble.left.and.bubble.right")
                                .font(.system(size: 16))
                                .foregroundStyle(.secondary)
                            Text("IM 频道")
                            Spacer()
                            Text("Beta")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.blue)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.blue.opacity(0.15))
                                .clipShape(Capsule())
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.vertical, 12)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            // Segment control
            Section {
                HStack(spacing: 0) {
                    Text("任务")
                        .font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(Color(.systemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
                    
                    Text("频道")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .padding(3)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.bottom, 8)
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
                        var deletedCurrent = false
                        for index in indexSet {
                            let session = sessions[index]
                            if session.sessionId == chatVM.currentSessionId {
                                deletedCurrent = true
                            }
                            await sessionVM.deleteSession(session.sessionId)
                        }
                        if deletedCurrent {
                            if let next = sessionVM.sessions.first {
                                selectedSessionId = next.sessionId
                                await chatVM.switchSession(next.sessionId, title: next.title)
                            } else {
                                chatVM.newSession()
                                selectedSessionId = chatVM.currentSessionId
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Text("任务")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.bottom, 4)
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
