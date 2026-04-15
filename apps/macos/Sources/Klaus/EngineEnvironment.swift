import Foundation
import OSLog

/// Locates the `bun` runtime and the engine `dist/cli.js` needed to run the CC engine.
@MainActor
final class EngineEnvironment {
    static let shared = EngineEnvironment()

    private let logger = Logger(subsystem: "ai.klaus", category: "engine-env")

    struct Status: Sendable {
        var bunAvailable = false
        var bunPath: String?
        var bunVersion: String?
        var enginePath: String?
        var engineAvailable = false
    }

    private(set) var status = Status()

    /// Resolve bun binary and engine dist/cli.js paths.
    func refresh() {
        resolveBun()
        resolveEngine()
        logger.info("EngineEnvironment: bun=\(self.status.bunAvailable) path=\(self.status.bunPath ?? "nil", privacy: .public) engine=\(self.status.engineAvailable) enginePath=\(self.status.enginePath ?? "nil", privacy: .public)")
    }

    // MARK: - Bun Resolution

    private func resolveBun() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
        ]

        // Try `which bun` via login shell first (picks up PATH)
        if let whichResult = shell("which bun") {
            let trimmed = whichResult.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && FileManager.default.fileExists(atPath: trimmed) {
                status.bunPath = trimmed
                status.bunAvailable = true
            }
        }

        if status.bunPath == nil {
            for path in candidates {
                if FileManager.default.fileExists(atPath: path) {
                    status.bunPath = path
                    status.bunAvailable = true
                    break
                }
            }
        }

        // Get version
        if let bin = status.bunPath, let v = shell("\(bin) --version 2>/dev/null") {
            status.bunVersion = v.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    // MARK: - Engine Resolution

    private func resolveEngine() {
        // 1. Check bundled in app resources
        if let resourcePath = Bundle.main.resourcePath {
            let bundled = "\(resourcePath)/engine/dist/cli.js"
            if FileManager.default.fileExists(atPath: bundled) {
                status.enginePath = bundled
                status.engineAvailable = true
                return
            }
        }

        // 2. Check development path relative to the app binary
        //    During development, the engine may be at apps/macos/engine/dist/cli.js
        let executableDir = Bundle.main.bundlePath
        let devPaths = [
            // Running from Xcode build
            "\(executableDir)/../../../engine/dist/cli.js",
            // Common development layout
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/workspace/klaus/apps/macos/engine/dist/cli.js",
        ]

        for path in devPaths {
            let resolved = (path as NSString).standardizingPath
            if FileManager.default.fileExists(atPath: resolved) {
                status.enginePath = resolved
                status.engineAvailable = true
                return
            }
        }
    }

    // MARK: - Shell Helper

    private func shell(_ command: String) -> String? {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            guard process.terminationStatus == 0 else { return nil }
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }
}
