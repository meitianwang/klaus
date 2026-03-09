import SwiftUI

/// Main chat view with message list, streaming indicator, and input bar.
struct ChatView: View {
    @ObservedObject var viewModel: ChatViewModel
    @EnvironmentObject private var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Connection status banner
            if appState.webSocket.state != .connected {
                HStack(spacing: 6) {
                    Circle()
                        .fill(appState.webSocket.state == .connecting ? .yellow : .red)
                        .frame(width: 8, height: 8)
                    Text(appState.webSocket.state == .connecting ? L10n.connecting : L10n.disconnected)
                        .font(.caption)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(appState.webSocket.state == .connecting ? Color.yellow.opacity(0.15) : Color.red.opacity(0.1))
            }

            // Config update banner (auto-dismiss after 15s)
            if viewModel.configUpdateBanner {
                HStack {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.blue)
                    Text(L10n.configUpdated)
                        .font(.caption)
                    Spacer()
                    Button(L10n.dismiss) {
                        viewModel.configUpdateBanner = false
                    }
                    .font(.caption)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.blue.opacity(0.08))
            }

            // Messages or welcome
            if viewModel.messages.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
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
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(viewModel.messages, id: \.id) { message in
                                MessageBubble(message: message, baseURL: appState.api.baseURL)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                    .onChange(of: viewModel.messages.count) { _ in
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(viewModel.messages.last?.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Error banner
            if let error = viewModel.errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                    Button(L10n.dismiss) {
                        viewModel.errorMessage = nil
                    }
                    .font(.caption)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.red.opacity(0.08))
            }

            Divider()

            // Input bar
            ChatInputBar(viewModel: viewModel)
        }
        .sheet(item: $viewModel.pendingPermission) { permission in
            PermissionSheet(
                permission: permission,
                onDecision: { allow in viewModel.approvePermission(allow) }
            )
            .presentationDetents([.medium])
        }
        .task {
            await viewModel.loadHistory()
        }
    }
}
