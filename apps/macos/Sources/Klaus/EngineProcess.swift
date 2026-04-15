import Foundation
import OSLog

/// Manages the CC engine as a Bun subprocess, communicating via stdin/stdout NDJSON.
/// Replaces DaemonProcessManager + DaemonConnection.
@MainActor
@Observable
final class EngineProcess {
    static let shared = EngineProcess()

    enum Status: Sendable, Equatable {
        case idle
        case starting
        case running
        case stopping
        case failed(String)

        var isActive: Bool {
            if case .running = self { return true }
            return false
        }

        var displayText: String {
            switch self {
            case .idle: L10n.idle
            case .starting: L10n.starting
            case .running: L10n.running
            case .stopping: L10n.stopping
            case .failed(let reason): L10n.failed(reason)
            }
        }
    }

    // MARK: - Public State

    private(set) var status: Status = .idle
    private(set) var sessionId: String?
    private(set) var model: String?
    private(set) var engineVersion: String?

    // MARK: - Callbacks

    /// Called for each parsed engine output message (on main actor).
    var onMessage: (@MainActor (EngineMessage) -> Void)?

    /// Called specifically for permission requests that need UI prompt.
    var onPermissionRequest: (@MainActor (ControlRequestMessage) -> Void)?

    // MARK: - Private

    private let logger = Logger(subsystem: "ai.klaus", category: "engine-process")
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var readTask: Task<Void, Never>?
    private var stderrTask: Task<Void, Never>?
    private let writeQueue = DispatchQueue(label: "ai.klaus.engine.stdin", qos: .userInitiated)
    private let jsonEncoder: JSONEncoder = {
        let enc = JSONEncoder()
        enc.outputFormatting = [] // compact, no pretty-print
        return enc
    }()

    // MARK: - Lifecycle

    /// Start the CC engine subprocess.
    /// - Parameters:
    ///   - cwd: Working directory for the engine (defaults to home).
    ///   - resumeSessionId: Pass a session ID to resume a previous conversation.
    ///   - modelOverride: Override the default model.
    ///   - permissionMode: Permission mode (default, plan, acceptEdits, bypassPermissions).
    func start(cwd: String? = nil, resumeSessionId: String? = nil, modelOverride: String? = nil, permissionMode: String? = nil) {
        guard status != .starting, !status.isActive else {
            logger.warning("Engine already active or starting, ignoring start()")
            return
        }

        status = .starting
        sessionId = nil
        model = nil

        guard let bunPath = EngineEnvironment.shared.status.bunPath else {
            status = .failed("Bun not found. Install from https://bun.sh")
            return
        }

        guard let enginePath = EngineEnvironment.shared.status.enginePath else {
            status = .failed("Engine dist/cli.js not found. Run build.sh first.")
            return
        }

        // Build arguments
        var args = [
            enginePath,
            "--print",
            "--input-format=stream-json",
            "--output-format=stream-json",
            "--verbose",
        ]

        if let sid = resumeSessionId {
            args.append("--resume")
            args.append(sid)
        }

        if let model = modelOverride {
            args.append("--model")
            args.append(model)
        }

        if let mode = permissionMode, mode != "default" {
            switch mode {
            case "plan":
                args.append("--permission-mode")
                args.append("plan")
            case "acceptEdits":
                args.append("--permission-mode")
                args.append("acceptEdits")
            case "bypassPermissions":
                args.append("--dangerously-skip-permissions")
            default:
                break
            }
        }

        // Set up pipes
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: bunPath)
        proc.arguments = args
        proc.standardInput = stdin
        proc.standardOutput = stdout
        proc.standardError = stderr

        // Inherit environment
        var env = ProcessInfo.processInfo.environment
        // Ensure engine finds ~/.claude config
        if let home = env["HOME"] {
            env["CLAUDE_CONFIG_DIR"] = "\(home)/.claude"
        }
        if let cwdPath = cwd {
            proc.currentDirectoryURL = URL(fileURLWithPath: cwdPath)
        }
        proc.environment = env

        // Termination handler
        proc.terminationHandler = { [weak self] process in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let code = process.terminationStatus
                if self.status == .stopping {
                    self.status = .idle
                    self.logger.info("Engine stopped gracefully")
                } else {
                    self.status = .failed("Engine exited (code \(code))")
                    self.logger.error("Engine exited unexpectedly with code \(code)")
                }
                self.cleanup()
            }
        }

        do {
            try proc.run()
        } catch {
            status = .failed(error.localizedDescription)
            logger.error("Failed to start engine: \(error.localizedDescription)")
            return
        }

        self.process = proc
        self.stdinPipe = stdin
        self.stdoutPipe = stdout
        self.stderrPipe = stderr

        // Start stdout reader
        startStdoutReader(pipe: stdout)
        // Start stderr logger
        startStderrLogger(pipe: stderr)

        logger.info("Engine process started (PID \(proc.processIdentifier))")
    }

    /// Stop the engine gracefully.
    func stop() {
        guard let proc = process, proc.isRunning else {
            status = .idle
            return
        }

        status = .stopping

        // Close stdin to signal EOF — engine should exit cleanly
        stdinPipe?.fileHandleForWriting.closeFile()

        // Give it a few seconds, then force kill
        Task {
            try? await Task.sleep(for: .seconds(3))
            await MainActor.run {
                if let proc = self.process, proc.isRunning {
                    proc.terminate()
                    self.logger.warning("Engine force-terminated after timeout")
                }
            }
        }
    }

    /// Send an interrupt to cancel the current request.
    func interrupt() {
        // CC handles SIGINT for interruption
        if let proc = process, proc.isRunning {
            kill(proc.processIdentifier, SIGINT)
        }
    }

    // MARK: - Sending Messages

    /// Send a user text message to the engine.
    func sendUserMessage(_ text: String) {
        let msg = SDKUserMessage(content: text)
        writeJSON(msg)
    }

    /// Send a user message with content blocks (e.g., images).
    func sendUserMessage(blocks: [APIContentBlock]) {
        let msg = SDKUserMessage(contentBlocks: blocks)
        writeJSON(msg)
    }

    /// Send a control response (e.g., permission decision).
    func sendControlResponse(_ response: SDKControlResponse) {
        writeJSON(response)
    }

    /// Convenience: allow a tool permission request.
    func allowTool(requestId: String, permanently: Bool = false, suggestions: [PermissionUpdate]? = nil) {
        var allow = PermissionAllow()
        allow.decisionClassification = permanently ? "user_permanent" : "user_temporary"
        if permanently, let suggestions {
            allow.updatedPermissions = suggestions
        }
        let response = SDKControlResponse(
            response: .success(ControlSuccessResponse(
                request_id: requestId,
                response: .allow(allow)
            ))
        )
        sendControlResponse(response)
    }

    /// Convenience: deny a tool permission request.
    func denyTool(requestId: String, message: String = "Denied by user") {
        let response = SDKControlResponse(
            response: .success(ControlSuccessResponse(
                request_id: requestId,
                response: .deny(PermissionDeny(message: message, decisionClassification: "user_reject"))
            ))
        )
        sendControlResponse(response)
    }

    // MARK: - Private: Writing

    private func writeJSON<T: Encodable>(_ value: T) {
        guard let pipe = stdinPipe else {
            logger.warning("Cannot write to engine: stdin pipe is nil")
            return
        }

        do {
            var data = try jsonEncoder.encode(value)
            data.append(0x0A) // newline
            writeQueue.async {
                pipe.fileHandleForWriting.write(data)
            }
        } catch {
            logger.error("Failed to encode message: \(error.localizedDescription)")
        }
    }

    // MARK: - Private: Reading

    private func startStdoutReader(pipe: Pipe) {
        readTask = Task.detached {
            let handle = pipe.fileHandleForReading
            var buffer = Data()

            while true {
                let chunk = handle.availableData
                if chunk.isEmpty { break } // EOF

                buffer.append(chunk)

                // Split on newlines and process complete lines
                while let newlineIndex = buffer.firstIndex(of: 0x0A) {
                    let lineData = buffer[buffer.startIndex..<newlineIndex]
                    buffer = Data(buffer[(newlineIndex + 1)...])

                    if lineData.isEmpty { continue }

                    if let message = EngineMessage.decode(from: Data(lineData)) {
                        await EngineProcess.shared.handleMessage(message)
                    }
                }
            }
        }
    }

    private func startStderrLogger(pipe: Pipe) {
        let logger = self.logger
        stderrTask = Task.detached {
            let handle = pipe.fileHandleForReading
            while true {
                let data = handle.availableData
                if data.isEmpty { break }
                if let line = String(data: data, encoding: .utf8) {
                    logger.debug("Engine stderr: \(line, privacy: .public)")
                }
            }
        }
    }

    // MARK: - Private: Message Handling

    @MainActor
    private func handleMessage(_ message: EngineMessage) {
        switch message {
        case .system(let init_msg):
            sessionId = init_msg.session_id
            model = init_msg.model
            engineVersion = init_msg.claude_code_version
            status = .running
            logger.info("Engine initialized: session=\(init_msg.session_id) model=\(init_msg.model) tools=\(init_msg.tools.count)")

        case .controlRequest(let request):
            if request.request.subtype == "can_use_tool" {
                onPermissionRequest?(request)
            }
            // Other control request subtypes (hook_callback, etc.) can be handled here

        case .result(let result):
            if result.is_error {
                logger.warning("Engine result error: \(result.errors?.joined(separator: ", ") ?? "unknown")")
            }

        default:
            break
        }

        // Forward all messages to the generic handler
        onMessage?(message)
    }

    // MARK: - Private: Cleanup

    private func cleanup() {
        readTask?.cancel()
        stderrTask?.cancel()
        readTask = nil
        stderrTask = nil
        stdinPipe = nil
        stdoutPipe = nil
        stderrPipe = nil
        process = nil
    }
}

