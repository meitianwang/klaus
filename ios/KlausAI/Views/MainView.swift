import SwiftUI

/// Main app view with sidebar (sessions) and detail (chat).
struct MainView: View {
    @EnvironmentObject private var appState: AppState
    @State private var chatVM: ChatViewModel?
    @State private var sessionVM: SessionListViewModel?
    @State private var showSettings = false
    @State private var selectedSessionId: String? = "default"
    @State private var columnVisibility = NavigationSplitViewVisibility.automatic

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            // Sidebar: sessions
            if let sessionVM, let chatVM {
                SessionListView(
                    sessionVM: sessionVM,
                    chatVM: chatVM,
                    selectedSessionId: $selectedSessionId
                )
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        HStack(spacing: 8) {
                            Image("KlausLogo")
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 28, height: 28)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            Text(L10n.appName)
                                .font(.headline)
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button {
                            showSettings = true
                        } label: {
                            UserAvatarView(
                                name: appState.currentUser?.displayName ?? "",
                                size: 30
                            )
                        }
                    }
                }
            }
        } detail: {
            // Detail: chat
            if let chatVM {
                ChatView(viewModel: chatVM)
                    .toolbar {
                        ToolbarItem(placement: .principal) {
                            Text(chatTitle)
                                .font(.headline)
                        }
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Circle()
                                .fill(connectionColor)
                                .frame(width: 8, height: 8)
                        }
                    }
                    .navigationBarTitleDisplayMode(.inline)
            } else {
                WelcomeView()
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(appState)
        }
        .onAppear {
            if chatVM == nil {
                chatVM = ChatViewModel(appState: appState)
                sessionVM = SessionListViewModel(appState: appState)
            }
        }
    }

    private var chatTitle: String {
        if let title = chatVM?.currentSessionTitle, !title.isEmpty {
            return title
        }
        if let sessionId = chatVM?.currentSessionId, sessionId != "default" {
            return sessionId
        }
        return L10n.appName
    }

    private var connectionColor: Color {
        switch appState.webSocket.state {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .red
        }
    }
}

/// User avatar with initials, similar to Gemini's style.
struct UserAvatarView: View {
    let name: String
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(.systemGray4))
            Text(initials)
                .font(.system(size: size * 0.4, weight: .medium))
                .foregroundStyle(.primary)
        }
        .frame(width: size, height: size)
    }

    private var initials: String {
        let parts = name.split(separator: " ")
        if let first = parts.first?.first {
            return String(first).uppercased()
        }
        return "U"
    }
}

/// Welcome view shown when chat is empty (Gemini style).
struct WelcomeView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image("KlausLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            Text(L10n.welcomeMessage)
                .font(.title2)
                .multilineTextAlignment(.center)
                .foregroundStyle(.primary)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Replacement for ContentUnavailableView (iOS 17+)
struct EmptyStateView: View {
    let title: String
    let systemImage: String
    let description: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(description)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
