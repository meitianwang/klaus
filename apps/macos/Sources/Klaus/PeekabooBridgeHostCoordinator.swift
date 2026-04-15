import Foundation
import OSLog

/// Stub for Peekaboo UI automation bridge.
/// Peekaboo dependency temporarily disabled due to Swift 6.2 incompatibility.
@MainActor
final class PeekabooBridgeHostCoordinator {
    static let shared = PeekabooBridgeHostCoordinator()

    private let logger = Logger(subsystem: "ai.klaus", category: "peekaboo")

    func setEnabled(_ enabled: Bool) async {
        if enabled {
            logger.info("Peekaboo bridge not available (dependency disabled)")
        }
    }

    func stop() async {}
}
