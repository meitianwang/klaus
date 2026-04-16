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
        if isPad { return 260 }
        return min(geometry.size.width - 60, 320)
    }

    private var rightSidebarWidth: CGFloat {
        return isPad ? 260 : 0
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
                .padding(.trailing, rightSidebarWidth)

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

                // Right Sidebar Layer
                if isPad {
                    RightSidebarView()
                        .frame(width: rightSidebarWidth)
                        .background(Color(.systemGroupedBackground).ignoresSafeArea())
                        .offset(x: geometry.size.width - rightSidebarWidth)
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
        .onChange(of: isSidebarOpened) { opened in
            if opened {
                Task { await sessionVM?.loadSessions() }
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
                } else {
                    Text(chatTitle)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.primary)
                }

                Spacer()

                if showHamburger {
                    Button {
                        showSettings = true
                    } label: {
                        UserAvatarView(
                            name: appState.currentUser?.displayName ?? "",
                            size: 30,
                            avatarUrl: appState.currentUser?.avatarUrl
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        // 问题反馈
                        print("反馈")
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "questionmark.square")
                            Text("问题反馈")
                        }
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    
                    HStack(spacing: 4) {
                        Image(systemName: "timer")
                        Text("37%")
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .padding(.leading, 12)
                }
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

/// User avatar with remote image support and initials fallback.
struct UserAvatarView: View {
    let name: String
    let size: CGFloat
    var avatarUrl: String? = nil
    var baseURL: String = "https://klaus-ai.site"

    var body: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [Color.blue.opacity(0.6), Color.purple.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))

            if let avatarUrl, let url = URL(string: baseURL + avatarUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        initialsView
                    }
                }
            } else {
                initialsView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initialsView: some View {
        Text(initials)
            .font(.system(size: size * 0.45, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
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

// MARK: - Right Sidebar (Task Monitor)

struct RightSidebarView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("任务监控")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Spacer()
                Image(systemName: "sidebar.right")
                    .foregroundStyle(.primary)
                    .font(.system(size: 16))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            
            Divider()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // 待办 (To Do)
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("待办")
                                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        
                        VStack(alignment: .leading, spacing: 10) {
                            TaskRow(title: "转换 ATA 文章为 Markdown", isCompleted: true)
                            TaskRow(title: "保存到输出目录和桌面", isCompleted: true)
                        }
                    }
                    
                    // 产物 (Artifacts)
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("产物")
                                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        
                        Text("默认工作目录")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        Text("最终文件")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            FileRow(filename: "1001人公司.md")
                            FileRow(filename: "跟AI聊一聊: 在AI乱世中....md")
                            FileRow(filename: "重新定义团队: 当Agent....md")
                            FileRow(filename: "聊聊 AI 时代的产品护城河.md")
                            FileRow(filename: "PresentationOS: AI PPT....md")
                        }
                    }
                    
                    // 工作文件 (Working Files)
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("工作文件")
                                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            Spacer()
                            Image(systemName: "chevron.up")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        
                        FileRow(filename: "u4e8b.md'")
                        
                        HStack {
                            Image(systemName: "doc.text")
                                .foregroundStyle(.secondary)
                            Text("~ (1)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                        
                        FileRow(filename: "我给 Claude Code 写了....md")
                    }
                }
                .padding(16)
            }
        }
        .background(Color(.systemBackground))
        .overlay(
            Rectangle()
                .frame(width: 1)
                .foregroundStyle(Color(.systemGray5)),
            alignment: .leading
        )
    }
}

struct TaskRow: View {
    let title: String
    let isCompleted: Bool
    
    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: isCompleted ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 14))
                .foregroundStyle(isCompleted ? .primary : .secondary)
            
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(isCompleted ? .secondary : .primary)
                .strikethrough(isCompleted)
        }
    }
}

struct FileRow: View {
    let filename: String
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text.fill")
                .font(.system(size: 13))
                .foregroundStyle(.primary)
            Text(filename)
                .font(.system(size: 13))
                .lineLimit(1)
            Spacer()
        }
        .padding(.vertical, 4)
    }
}
