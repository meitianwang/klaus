import SwiftUI

/// Main app view with a custom drawer sidebar and detail chat view.
struct MainView: View {
    @EnvironmentObject private var appState: AppState
    @State private var chatVM: ChatViewModel?
    @State private var sessionVM: SessionListViewModel?
    @State private var showSettings = false
    @State private var selectedSessionId: String? = "default"
    @State private var isSidebarOpened = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isPad: Bool {
        horizontalSizeClass == .regular
    }

    private func sidebarWidth(geometry: GeometryProxy) -> CGFloat {
        if isPad { return 320 }
        return min(geometry.size.width - 60, 320)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Detail Layer
                NavigationStack {
                    ZStack {
                        Color(.systemGroupedBackground).ignoresSafeArea()

                        if let chatVM {
                            ChatViewWrapper(
                                chatVM: chatVM,
                                chatTitle: chatTitle,
                                isSidebarOpened: $isSidebarOpened,
                                showHamburger: !isPad
                            )
                        } else {
                            VStack(spacing: 0) {
                                if !isPad {
                                    HStack {
                                        Button {
                                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                                isSidebarOpened.toggle()
                                            }
                                        } label: {
                                            Image(systemName: "line.3.horizontal")
                                                .font(.system(size: 20, weight: .medium))
                                                .foregroundStyle(.primary)
                                        }
                                        .buttonStyle(.plain)

                                        Spacer()
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(.ultraThinMaterial)
                                }
                                WelcomeView()
                            }
                            .toolbar(.hidden, for: .navigationBar)
                        }
                    }
                }
                .padding(.leading, isPad ? sidebarWidth(geometry: geometry) : 0)

                // Dimming Layer
                if isSidebarOpened && !isPad {
                    Color.black.opacity(0.3)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                isSidebarOpened = false
                            }
                        }
                        .zIndex(1)
                }

                // Sidebar Drawer Layer
                if let sessionVM, let chatVM {
                    SidebarWrapper(
                        sessionVM: sessionVM,
                        chatVM: chatVM,
                        selectedSessionId: $selectedSessionId,
                        showSettings: $showSettings,
                        appState: appState,
                        onSessionSelect: {
                            if !isPad {
                                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                    isSidebarOpened = false
                                }
                            }
                        }
                    )
                    .frame(width: sidebarWidth(geometry: geometry))
                    .background(Color(.systemGroupedBackground).ignoresSafeArea())
                    .offset(x: (isSidebarOpened || isPad) ? 0 : -sidebarWidth(geometry: geometry) - 20)
                    .shadow(color: (!isPad && isSidebarOpened) ? Color.black.opacity(0.15) : .clear, radius: 20, x: 5, y: 0)
                    .zIndex(2)
                }
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
}

/// A wrapper for the Sidebar list layout
struct SidebarWrapper: View {
    @ObservedObject var sessionVM: SessionListViewModel
    @ObservedObject var chatVM: ChatViewModel
    @Binding var selectedSessionId: String?
    @Binding var showSettings: Bool
    let appState: AppState
    let onSessionSelect: () -> Void

    var body: some View {
        NavigationStack {
            SessionListView(
                sessionVM: sessionVM,
                chatVM: chatVM,
                selectedSessionId: Binding(get: { selectedSessionId }, set: { val in
                    selectedSessionId = val
                    onSessionSelect()
                })
            )
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    HStack(spacing: 8) {
                        Image("KlausLogo")
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 28, height: 28)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .shadow(color: Color.black.opacity(0.1), radius: 2, x: 0, y: 1)
                        Text(L10n.appName)
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(.primary)
                    }
                }
            }
        }
    }
}

/// A wrapper for ChatView to apply custom toolbar items like the hamburger menu.
struct ChatViewWrapper: View {
    @ObservedObject var chatVM: ChatViewModel
    let chatTitle: String
    @Binding var isSidebarOpened: Bool
    let showHamburger: Bool
    @EnvironmentObject private var appState: AppState
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            // Custom header bar (no system toolbar circle backgrounds)
            HStack {
                if showHamburger {
                    Button {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                            isSidebarOpened.toggle()
                        }
                    } label: {
                        Image(systemName: "line.3.horizontal")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.primary)
                    }
                    .buttonStyle(.plain)
                }

                Spacer()

                Button {
                    showSettings = true
                } label: {
                    UserAvatarView(
                        name: appState.currentUser?.displayName ?? "",
                        size: 30
                    )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)

            ChatView(viewModel: chatVM)
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(appState)
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
                .fill(LinearGradient(colors: [Color.blue.opacity(0.6), Color.purple.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))
            
            Text(initials)
                .font(.system(size: size * 0.45, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
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
        VStack(alignment: .leading, spacing: 16) {
            Text(L10n.welcomeMessage)
                .font(.system(size: 32, weight: .regular))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
            
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.top, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Replacement for ContentUnavailableView (iOS 17+)
struct EmptyStateView: View {
    let title: String
    let systemImage: String
    let description: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: systemImage)
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(LinearGradient(colors: [Color.accentColor, Color.purple], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: Color.purple.opacity(0.2), radius: 10, x: 0, y: 5)
                
            VStack(spacing: 8) {
                Text(title)
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
