import SwiftUI

/// Settings view using native iOS grouped list style.
struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var showLogoutConfirm = false

    var body: some View {
        NavigationStack {
            List {
                if let user = appState.currentUser {
                    // Account section
                    Section {
                        HStack(spacing: 14) {
                            UserAvatarView(name: user.displayName, size: 48)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName)
                                    .font(.system(.body, weight: .semibold))
                                Text(user.email)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }

                    // Info section
                    Section {
                        HStack {
                            Label(L10n.roleLabel, systemImage: "person.badge.shield.checkmark")
                            Spacer()
                            Text(user.role == "admin" ? "管理员" : "用户")
                                .foregroundStyle(.secondary)
                        }

                        HStack {
                            Label(L10n.version, systemImage: "info.circle")
                            Spacer()
                            Text("1.0.0")
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Logout section
                    Section {
                        Button(role: .destructive) {
                            showLogoutConfirm = true
                        } label: {
                            Label(L10n.logOut, systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(L10n.settings)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.done) { dismiss() }
                        .font(.system(.body, weight: .medium))
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
}
