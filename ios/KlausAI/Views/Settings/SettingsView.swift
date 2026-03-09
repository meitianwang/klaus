import SwiftUI

/// Settings view with Gemini-style account header.
struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var showLogoutConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    // Account header (Gemini style)
                    if let user = appState.currentUser {
                        VStack(spacing: 12) {
                            UserAvatarView(name: user.displayName, size: 64)

                            Text(user.displayName)
                                .font(.title3.weight(.semibold))

                            Text(user.email)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, 24)
                        .padding(.bottom, 20)
                    }

                    // Connection status
                    HStack {
                        Circle()
                            .fill(connectionColor)
                            .frame(width: 8, height: 8)
                        Text(connectionLabel)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)

                    Divider().padding(.horizontal, 20)

                    // Menu items
                    VStack(spacing: 0) {
                        if let user = appState.currentUser {
                            settingsRow(
                                icon: "person.fill",
                                title: L10n.roleLabel,
                                detail: user.role == "admin" ? "管理员" : "用户"
                            )
                        }

                        settingsRow(
                            icon: "info.circle",
                            title: L10n.version,
                            detail: "1.0.0"
                        )

                        Divider().padding(.horizontal, 20)

                        // Logout
                        Button {
                            showLogoutConfirm = true
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                    .font(.body)
                                    .foregroundStyle(.red)
                                    .frame(width: 24)
                                Text(L10n.logOut)
                                    .font(.body)
                                    .foregroundStyle(.red)
                                Spacer()
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 14)
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.done) { dismiss() }
                }
            }
            .confirmationDialog(L10n.logOutConfirm, isPresented: $showLogoutConfirm) {
                Button(L10n.logOut, role: .destructive) {
                    Task {
                        await appState.logout()
                        dismiss()
                    }
                }
            }
        }
    }

    private func settingsRow(icon: String, title: String, detail: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 24)
            Text(title)
                .font(.body)
            Spacer()
            Text(detail)
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private var connectionColor: Color {
        switch appState.webSocket.state {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .red
        }
    }

    private var connectionLabel: String {
        switch appState.webSocket.state {
        case .connected: return L10n.connected
        case .connecting: return L10n.connecting
        case .disconnected: return L10n.disconnected
        }
    }
}
