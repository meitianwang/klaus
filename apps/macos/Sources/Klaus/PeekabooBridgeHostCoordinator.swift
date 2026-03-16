import Foundation
import OSLog
import PeekabooBridge
import PeekabooAutomationKit
import Security

/// Coordinates the Peekaboo UI automation bridge.
@MainActor
final class PeekabooBridgeHostCoordinator {
    static let shared = PeekabooBridgeHostCoordinator()

    private let logger = Logger(subsystem: "ai.klaus", category: "peekaboo")
    private var host: PeekabooBridgeHost?
    private var services: KlausPeekabooBridgeServices?

    private static let socketDir: String = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.klaus"
    }()

    private static let socketPath = "\(socketDir)/bridge.sock"

    func setEnabled(_ enabled: Bool) async {
        if enabled { await startIfNeeded() } else { await stop() }
    }

    func stop() async {
        guard let host else { return }
        await host.stop()
        self.host = nil
        self.services = nil
        logger.info("Peekaboo bridge stopped")
    }

    private func startIfNeeded() async {
        guard host == nil else { return }

        var allowlistedTeamIDs: Set<String> = []
        if let teamID = Self.currentTeamID() {
            allowlistedTeamIDs.insert(teamID)
        }

        let fm = FileManager.default
        if !fm.fileExists(atPath: Self.socketDir) {
            try? fm.createDirectory(atPath: Self.socketDir, withIntermediateDirectories: true)
        }
        chmod(Self.socketDir, 0o700)

        let bridgeServices = KlausPeekabooBridgeServices()
        let server = PeekabooBridgeServer(
            services: bridgeServices,
            hostKind: .gui,
            allowlistedTeams: allowlistedTeamIDs,
            allowlistedBundles: []
        )
        let bridgeHost = PeekabooBridgeHost(
            socketPath: Self.socketPath,
            server: server,
            allowedTeamIDs: allowlistedTeamIDs,
            requestTimeoutSec: 10
        )

        self.services = bridgeServices
        self.host = bridgeHost
        await bridgeHost.start()
        logger.info("Peekaboo bridge started at \(Self.socketPath, privacy: .public)")
    }

    private static func currentTeamID() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info
        ) == errSecSuccess, let info = info as? [String: Any] else { return nil }
        return info[kSecCodeInfoTeamIdentifier as String] as? String
    }
}

// MARK: - Bridge Services

@MainActor
private final class KlausPeekabooBridgeServices: PeekabooBridgeServiceProviding {
    let permissions: PermissionsService
    let screenCapture: any ScreenCaptureServiceProtocol
    let automation: any UIAutomationServiceProtocol
    let windows: any WindowManagementServiceProtocol
    let applications: any ApplicationServiceProtocol
    let menu: any MenuServiceProtocol
    let dock: any DockServiceProtocol
    let dialogs: any DialogServiceProtocol
    let snapshots: any SnapshotManagerProtocol

    init() {
        let logging = LoggingService(subsystem: "ai.klaus.peekaboo")

        self.snapshots = InMemorySnapshotManager(options: .init(
            snapshotValidityWindow: 600,
            maxSnapshots: 50,
            deleteArtifactsOnCleanup: false
        ))
        self.permissions = PermissionsService()
        self.screenCapture = ScreenCaptureService(loggingService: logging)
        self.automation = UIAutomationService(
            snapshotManager: self.snapshots,
            loggingService: logging,
            searchPolicy: .balanced
        )
        self.windows = WindowManagementService()
        self.applications = ApplicationService()
        self.menu = MenuService()
        self.dock = DockService()
        self.dialogs = DialogService()
    }
}
