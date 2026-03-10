import SwiftUI

/// Root auth view that switches between login and register.
struct AuthView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var viewModel = AuthViewModel()
    @State private var isAnimating = false

    var body: some View {
        NavigationStack {
            ZStack {
                // Background Gradient
                LinearGradient(
                    colors: [Color.accentColor.opacity(0.4), Color.purple.opacity(0.3), Color(.systemBackground)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                .opacity(isAnimating ? 1 : 0.8)
                .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: isAnimating)
                .onAppear { isAnimating = true }

                ScrollView {
                    VStack(spacing: 32) {
                        // Header
                        VStack(spacing: 16) {
                            Image("KlausLogo")
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 88, height: 88)
                                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                .shadow(color: Color.black.opacity(0.15), radius: 10, x: 0, y: 5)
                            
                            Text(L10n.appName)
                                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                                .foregroundStyle(.primary)
                            
                            Text(viewModel.isRegisterMode ? "创建一个新账号" : "欢迎回来，请登录")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, 60)

                        // Form Card
                        VStack(spacing: 24) {
                            if viewModel.isRegisterMode {
                                RegisterFormView(viewModel: viewModel, appState: appState)
                            } else {
                                LoginFormView(viewModel: viewModel, appState: appState)
                            }

                            if let error = viewModel.errorMessage {
                                Text(error)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                                    .padding(.top, -8)
                                    .multilineTextAlignment(.center)
                            }
                        }
                        .padding(24)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .shadow(color: Color.black.opacity(0.08), radius: 20, x: 0, y: 10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                        )

                        // Toggle Mode
                        Button {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                viewModel.isRegisterMode.toggle()
                                viewModel.errorMessage = nil
                            }
                        } label: {
                            Group {
                                Text(viewModel.isRegisterMode ? L10n.switchToLogin : L10n.switchToRegister)
                                    .fontWeight(.medium)
                            }
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 40)
                }
            }
            .navigationBarHidden(true)
        }
    }
}

// Custom TextField Modifier (avoids private _body API)
struct PremiumFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding()
            .background(Color(.systemBackground).opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(.separator), lineWidth: 0.5)
            )
            .shadow(color: Color.black.opacity(0.02), radius: 5, x: 0, y: 2)
    }
}

extension View {
    func premiumFieldStyle() -> some View {
        self.modifier(PremiumFieldModifier())
    }
}

private struct LoginFormView: View {
    @ObservedObject var viewModel: AuthViewModel
    let appState: AppState

    var body: some View {
        VStack(spacing: 16) {
            TextField(L10n.emailPlaceholder, text: $viewModel.email)
                .textFieldStyle(.plain).premiumFieldStyle()
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)

            SecureField(L10n.passwordPlaceholder, text: $viewModel.password)
                .textFieldStyle(.plain).premiumFieldStyle()

            Button {
                Task { await viewModel.login(with: appState) }
            } label: {
                Group {
                    if viewModel.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text(L10n.loginButton)
                            .font(.headline)
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(viewModel.isLoginValid ? Color.accentColor : Color.accentColor.opacity(0.5))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: viewModel.isLoginValid ? Color.accentColor.opacity(0.4) : .clear, radius: 8, x: 0, y: 4)
            }
            .disabled(!viewModel.isLoginValid || viewModel.isLoading)
            .padding(.top, 8)
        }
    }
}

private struct RegisterFormView: View {
    @ObservedObject var viewModel: AuthViewModel
    let appState: AppState

    var body: some View {
        VStack(spacing: 16) {
            TextField(L10n.displayNamePlaceholder, text: $viewModel.displayName)
                .textFieldStyle(.plain).premiumFieldStyle()
                .textContentType(.name)

            TextField(L10n.emailPlaceholder, text: $viewModel.email)
                .textFieldStyle(.plain).premiumFieldStyle()
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)

            SecureField(L10n.passwordHint, text: $viewModel.password)
                .textFieldStyle(.plain).premiumFieldStyle()

            TextField(L10n.inviteCodePlaceholder, text: $viewModel.inviteCode)
                .textFieldStyle(.plain).premiumFieldStyle()
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Button {
                Task { await viewModel.register(with: appState) }
            } label: {
                Group {
                    if viewModel.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text(L10n.registerButton)
                            .font(.headline)
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(viewModel.isRegisterValid ? Color.accentColor : Color.accentColor.opacity(0.5))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: viewModel.isRegisterValid ? Color.accentColor.opacity(0.4) : .clear, radius: 8, x: 0, y: 4)
            }
            .disabled(!viewModel.isRegisterValid || viewModel.isLoading)
            .padding(.top, 8)
        }
    }
}
