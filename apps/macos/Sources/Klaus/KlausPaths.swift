import Foundation

/// Resolves paths used by the macOS app.
enum KlausPaths {
    static let configDir: String = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.klaus"
    }()

    static let claudeConfigDir: String = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/.claude"
    }()

    static let configFile = "\(configDir)/config.yaml"
    static let logDir = "\(configDir)/logs"
    static let logFile = "\(logDir)/klaus.log"
    static let canvasDir = "\(configDir)/canvas"

    /// Path to the engine dist/cli.js (resolved at runtime by EngineEnvironment).
    /// Access from @MainActor context only.
    @MainActor static var engineDistPath: String? {
        EngineEnvironment.shared.status.enginePath
    }
}
