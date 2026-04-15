import SwiftUI

/// Root settings view with tab navigation (11 tabs, matching OpenClaw).
struct SettingsRootView: View {
    let state: AppState

    var body: some View {
        TabView {
            GeneralSettingsView(state: state)
                .tabItem {
                    Label("General", systemImage: "gearshape")
                }

            MCPSettingsView()
                .tabItem {
                    Label("MCP", systemImage: "server.rack")
                }

            VoiceWakeSettingsView(state: state)
                .tabItem {
                    Label("Voice Wake", systemImage: "waveform")
                }

            ConfigEditorView()
                .tabItem {
                    Label("Config", systemImage: "doc.text")
                }

            InstancesSettingsView()
                .tabItem {
                    Label("Engine", systemImage: "cpu")
                }

            SessionsSettingsView()
                .tabItem {
                    Label("Sessions", systemImage: "bubble.left.and.bubble.right")
                }

            CronSettingsView()
                .tabItem {
                    Label("Cron", systemImage: "clock.arrow.circlepath")
                }

            SkillsSettingsView()
                .tabItem {
                    Label("Skills", systemImage: "sparkles")
                }

            PermissionsSettingsView()
                .tabItem {
                    Label("Permissions", systemImage: "lock.shield")
                }

            DebugSettingsView()
                .tabItem {
                    Label("Debug", systemImage: "ladybug")
                }

            AboutSettingsView()
                .tabItem {
                    Label("About", systemImage: "info.circle")
                }
        }
        .padding(20)
    }
}

// MARK: - General

struct GeneralSettingsView: View {
    @Bindable var state: AppState

    var body: some View {
        Form {
            Section("Engine") {
                LabeledContent("Status") {
                    Text(EngineProcess.shared.status.displayText)
                        .foregroundStyle(EngineProcess.shared.status.isActive ? .green : .secondary)
                }

                if let model = EngineProcess.shared.model {
                    LabeledContent("Model") {
                        Text(model)
                    }
                }

                if let version = EngineProcess.shared.engineVersion {
                    LabeledContent("Engine Version") {
                        Text(version)
                    }
                }

                LabeledContent("Bun") {
                    Text(EngineEnvironment.shared.status.bunVersion ?? "not found")
                        .foregroundStyle(EngineEnvironment.shared.status.bunAvailable ? Color.primary : Color.red)
                }

                Toggle("Show Dock Icon", isOn: $state.showDockIcon)
            }

            Section("Model") {
                Picker("Model", selection: $state.modelOverride) {
                    Text("Default").tag("")
                    Divider()
                    Text("claude-opus-4-6").tag("claude-opus-4-6")
                    Text("claude-sonnet-4-6").tag("claude-sonnet-4-6")
                    Text("claude-haiku-4-5").tag("claude-haiku-4-5")
                }
                .onChange(of: state.modelOverride) { _, _ in
                    // Model change takes effect on next engine restart
                }

                HStack {
                    TextField("Working Directory", text: $state.workingDirectory)
                        .textFieldStyle(.roundedBorder)
                    Button("Browse") {
                        let panel = NSOpenPanel()
                        panel.canChooseFiles = false
                        panel.canChooseDirectories = true
                        panel.allowsMultipleSelection = false
                        if panel.runModal() == .OK, let url = panel.url {
                            state.workingDirectory = url.path
                        }
                    }
                }

                Button("Restart Engine with New Settings") {
                    EngineProcess.shared.stop()
                    Task {
                        try? await Task.sleep(for: .milliseconds(500))
                        await MainActor.run {
                            let model = state.modelOverride.isEmpty ? nil : state.modelOverride
                            let cwd = state.workingDirectory.isEmpty ? nil : state.workingDirectory
                            EngineProcess.shared.start(cwd: cwd, modelOverride: model)
                        }
                    }
                }
            }

            Section("Permissions") {
                Picker("Permission Mode", selection: $state.permissionMode) {
                    Text("Default — ask before tools").tag("default")
                    Text("Plan — read-only, no edits").tag("plan")
                    Text("Accept Edits — auto-approve file changes").tag("acceptEdits")
                    Text("YOLO — auto-approve everything").tag("bypassPermissions")
                }
                .pickerStyle(.radioGroup)
            }

            Section("Config Files") {
                Button("Open ~/.claude/settings.json") {
                    let path = KlausPaths.claudeConfigDir + "/settings.json"
                    NSWorkspace.shared.open(URL(fileURLWithPath: path))
                }
                Button("Open ~/.claude/CLAUDE.md") {
                    let path = KlausPaths.claudeConfigDir + "/CLAUDE.md"
                    NSWorkspace.shared.open(URL(fileURLWithPath: path))
                }
            }

            Section("Features") {
                Toggle("Voice Wake", isOn: $state.voiceWakeEnabled)
                Toggle("Talk Mode", isOn: $state.talkEnabled)
                Toggle("Canvas", isOn: $state.canvasEnabled)
                Toggle("Peekaboo Bridge", isOn: $state.peekabooBridgeEnabled)
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Sessions

struct SessionsSettingsView: View {
    @State private var sessions: [[String: Any]] = []
    @State private var isLoading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Active Sessions")
                    .font(.headline)
                Spacer()
                Button("Refresh") { Task { await loadSessions() } }
            }

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
            } else if sessions.isEmpty {
                Text("No active sessions")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            } else {
                List {
                    ForEach(Array(sessions.enumerated()), id: \.offset) { _, session in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(session["sessionKey"] as? String ?? "unknown")
                                    .font(.body.monospaced())
                                if let model = session["model"] as? String {
                                    Text(model)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if let updatedAt = session["updatedAt"] as? Double {
                                Text(Date(timeIntervalSince1970: updatedAt / 1000), style: .relative)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .task { await loadSessions() }
    }

    private func loadSessions() async {
        isLoading = true
        defer { isLoading = false }
        // In engine mode, session info comes from EngineProcess
        let engine = EngineProcess.shared
        if let sid = engine.sessionId {
            sessions = [["sessionKey": sid, "model": engine.model ?? "unknown"]]
        } else {
            sessions = []
        }
    }
}

// MARK: - Cron

struct CronSettingsView: View {
    @State private var tasks: [[String: Any]] = []
    @State private var isLoading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Scheduled Tasks")
                    .font(.headline)
                Spacer()
                Button("Refresh") { Task { await loadTasks() } }
            }

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
            } else if tasks.isEmpty {
                Text("No scheduled tasks")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            } else {
                List {
                    ForEach(Array(tasks.enumerated()), id: \.offset) { _, task in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: (task["enabled"] as? Bool ?? true) ? "checkmark.circle.fill" : "xmark.circle")
                                    .foregroundStyle((task["enabled"] as? Bool ?? true) ? .green : .secondary)
                                Text(task["id"] as? String ?? "unknown")
                                    .font(.body.monospaced())
                                if let name = task["name"] as? String, !name.isEmpty {
                                    Text("(\(name))")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Text("Schedule: \(task["schedule"] as? String ?? "-")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding()
        .task { await loadTasks() }
    }

    private func loadTasks() async {
        isLoading = true
        defer { isLoading = false }
        // Cron tasks are managed by the engine internally via ~/.claude/
        // In engine mode, we show a placeholder directing users to the config
        tasks = []
    }
}

// MARK: - Permissions

struct PermissionsSettingsView: View {
    var body: some View {
        Form {
            Section("macOS Permissions") {
                PermissionRow(name: "Microphone", icon: "mic.fill", description: "Required for voice wake and talk mode")
                PermissionRow(name: "Speech Recognition", icon: "waveform", description: "Required for voice commands")
                PermissionRow(name: "Notifications", icon: "bell.fill", description: "Task completion alerts")
                PermissionRow(name: "Accessibility", icon: "accessibility", description: "UI automation features")
                PermissionRow(name: "Screen Recording", icon: "rectangle.dashed.badge.record", description: "Screen capture for AI context")
            }
        }
        .formStyle(.grouped)
    }
}

struct PermissionRow: View {
    let name: String
    let icon: String
    let description: String

    var body: some View {
        LabeledContent {
            Button("Grant") {
                // Will be implemented in Phase 6
            }
        } label: {
            Label {
                VStack(alignment: .leading) {
                    Text(name)
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: icon)
            }
        }
    }
}

// MARK: - Debug

struct DebugSettingsView: View {
    @State private var logContent = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Engine Log")
                .font(.headline)

            HStack {
                Button("Refresh") { loadLog() }
                Button("Open Log File") {
                    NSWorkspace.shared.open(URL(fileURLWithPath: KlausPaths.logFile))
                }
                Spacer()
                Button("Open Config") {
                    NSWorkspace.shared.open(URL(fileURLWithPath: KlausPaths.configFile))
                }
            }

            ScrollView {
                Text(logContent.isEmpty ? "No log content" : logContent)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: .infinity)
        }
        .padding()
        .onAppear { loadLog() }
    }

    private func loadLog() {
        let path = KlausPaths.logFile
        guard FileManager.default.fileExists(atPath: path),
              let content = try? String(contentsOfFile: path, encoding: .utf8) else {
            logContent = "Log file not found"
            return
        }
        // Show last 200 lines
        let lines = content.components(separatedBy: .newlines)
        logContent = lines.suffix(200).joined(separator: "\n")
    }
}

// MARK: - About

struct AboutSettingsView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 48))
                .foregroundStyle(.blue)

            Text("Klaus")
                .font(.title)

            Text("Multi-channel AI agent platform")
                .foregroundStyle(.secondary)

            if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String {
                Text("Version \(version)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            Text("Engine: \(EngineProcess.shared.engineVersion ?? "unknown")")
                .font(.caption)
                .foregroundStyle(.secondary)

            CheckForUpdatesView()
                .padding(.top, 4)
        }
        .padding(40)
    }
}

// MARK: - Channels

struct MCPSettingsView: View {
    @State private var servers: [(name: String, config: [String: Any])] = []
    @State private var isLoading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("MCP Servers")
                    .font(.headline)
                Spacer()
                Button("Refresh") { loadServers() }
                Button("Edit mcp.json") {
                    let path = KlausPaths.claudeConfigDir + "/mcp.json"
                    NSWorkspace.shared.open(URL(fileURLWithPath: path))
                }
            }

            if servers.isEmpty {
                VStack(spacing: 8) {
                    Text("No MCP servers configured")
                        .foregroundStyle(.secondary)
                    Text("Add servers to ~/.claude/mcp.json")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 20)
            } else {
                List {
                    ForEach(Array(servers.enumerated()), id: \.offset) { _, server in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Image(systemName: "server.rack")
                                    .foregroundStyle(.blue)
                                Text(server.name)
                                    .font(.body.weight(.medium))
                                Spacer()
                                if let command = server.config["command"] as? String {
                                    Text(command)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if let args = server.config["args"] as? [String] {
                                Text(args.joined(separator: " "))
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            }

            Text("MCP servers are managed via ~/.claude/mcp.json. Changes take effect on engine restart.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .onAppear { loadServers() }
    }

    private func loadServers() {
        let path = KlausPaths.claudeConfigDir + "/mcp.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let mcpServers = json["mcpServers"] as? [String: Any] else {
            servers = []
            return
        }
        servers = mcpServers.compactMap { (name, value) in
            guard let config = value as? [String: Any] else { return nil }
            return (name: name, config: config)
        }.sorted(by: { $0.name < $1.name })
    }
}

// MARK: - Voice Wake Settings

struct VoiceWakeSettingsView: View {
    @Bindable var state: AppState
    @State private var triggerWords = defaultVoiceWakeTriggers.joined(separator: ", ")
    @State private var hasUsableDevice = false

    var body: some View {
        Form {
            Section("Voice Wake") {
                Toggle("Enable Voice Wake", isOn: $state.voiceWakeEnabled)

                TextField("Trigger Words (comma-separated)", text: $triggerWords)
                    .textFieldStyle(.roundedBorder)

                LabeledContent("Microphone") {
                    Text(AudioInputDeviceObserver.shared.defaultDeviceName ?? "None detected")
                        .foregroundStyle(hasUsableDevice ? Color.primary : Color.red)
                }

                LabeledContent("Permissions") {
                    if PermissionManager.shared.voiceWakePermissionsGranted() {
                        Label("Granted", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    } else {
                        Button("Grant Permissions") {
                            Task {
                                _ = await PermissionManager.shared.ensure(
                                    [.microphone, .speechRecognition]
                                )
                            }
                        }
                    }
                }
            }

            Section("Talk Mode") {
                Toggle("Enable Talk Mode", isOn: $state.talkEnabled)

                LabeledContent("TTS Provider") {
                    Text("ElevenLabs (configure API key in config.yaml)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Audio Level") {
                MicLevelBar()
                    .frame(height: 20)
            }
        }
        .formStyle(.grouped)
        .onAppear {
            AudioInputDeviceObserver.shared.refresh()
            hasUsableDevice = AudioInputDeviceObserver.shared.hasUsableDevice
        }
    }
}

struct MicLevelBar: View {
    @State private var level: Float = 0
    private let segmentCount = 12

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<segmentCount, id: \.self) { i in
                let threshold = Float(i) / Float(segmentCount)
                RoundedRectangle(cornerRadius: 2)
                    .fill(segmentColor(for: i))
                    .opacity(level > threshold ? 1.0 : 0.15)
            }
        }
    }

    private func segmentColor(for index: Int) -> Color {
        let ratio = Float(index) / Float(segmentCount)
        if ratio < 0.65 { return .green }
        if ratio < 0.85 { return .yellow }
        return .red
    }
}

// MARK: - Config Editor

struct ConfigEditorView: View {
    @State private var configText = ""
    @State private var isSaving = false
    @State private var statusMessage = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("config.yaml")
                    .font(.headline)
                Spacer()
                if !statusMessage.isEmpty {
                    Text(statusMessage)
                        .font(.caption)
                        .foregroundStyle(statusMessage.contains("Error") ? .red : .green)
                }
                Button("Reload") { loadConfig() }
                Button("Save") { Task { await saveConfig() } }
                    .disabled(isSaving)
            }

            TextEditor(text: $configText)
                .font(.system(.body, design: .monospaced))
                .frame(maxHeight: .infinity)
                .border(Color.secondary.opacity(0.2))
        }
        .padding()
        .onAppear { loadConfig() }
    }

    private func loadConfig() {
        let path = KlausPaths.configFile
        if FileManager.default.fileExists(atPath: path),
           let content = try? String(contentsOfFile: path, encoding: .utf8) {
            configText = content
        } else {
            configText = "# No config file found\n# Run `klaus setup` to create one"
        }
        statusMessage = ""
    }

    private func saveConfig() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try configText.write(toFile: KlausPaths.configFile, atomically: true, encoding: .utf8)
            statusMessage = "Saved"
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }
}

// MARK: - Instances

struct InstancesSettingsView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "server.rack")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)

            Text("Engine Instance")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                LabeledContent("Engine Status") {
                    Text(EngineProcess.shared.status.displayText)
                }
                if let model = EngineProcess.shared.model {
                    LabeledContent("Model") {
                        Text(model)
                    }
                }
                if let version = EngineProcess.shared.engineVersion {
                    LabeledContent("Engine Version") {
                        Text(version)
                    }
                }
                LabeledContent("Bun Path") {
                    Text(EngineEnvironment.shared.status.bunPath ?? "not found")
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
                LabeledContent("Engine Path") {
                    Text(EngineEnvironment.shared.status.enginePath ?? "not found")
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
                LabeledContent("Config Dir") {
                    Text(KlausPaths.claudeConfigDir)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
                LabeledContent("Log") {
                    Text(KlausPaths.logFile)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: 400)
        }
        .padding()
    }
}

// MARK: - Skills

struct SkillsSettingsView: View {
    @State private var skills: [[String: Any]] = []
    @State private var isLoading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Installed Skills")
                    .font(.headline)
                Spacer()
                Button("Refresh") { Task { await loadSkills() } }
            }

            if isLoading {
                ProgressView().frame(maxWidth: .infinity, alignment: .center)
            } else if skills.isEmpty {
                VStack(spacing: 8) {
                    Text("No skills installed")
                        .foregroundStyle(.secondary)
                    Text("Use `/skills` in chat or configure in config.yaml")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
            } else {
                List {
                    ForEach(Array(skills.enumerated()), id: \.offset) { _, skill in
                        HStack {
                            if let emoji = skill["emoji"] as? String {
                                Text(emoji)
                            } else {
                                Image(systemName: "sparkles")
                                    .foregroundStyle(.purple)
                            }
                            VStack(alignment: .leading) {
                                Text(skill["name"] as? String ?? "unknown")
                                    .font(.body)
                                if let desc = skill["description"] as? String {
                                    Text(desc)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if let source = skill["source"] as? String {
                                Text(source)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.secondary.opacity(0.1), in: Capsule())
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .task { await loadSkills() }
    }

    private func loadSkills() async {
        isLoading = true
        defer { isLoading = false }
        // Skills are managed by the CC engine via ~/.claude/skills/
        // Scan the skills directory for installed skills
        let skillsDir = KlausPaths.claudeConfigDir + "/skills"
        let fm = FileManager.default
        guard fm.fileExists(atPath: skillsDir),
              let entries = try? fm.contentsOfDirectory(atPath: skillsDir) else {
            skills = []
            return
        }
        skills = entries.filter { !$0.hasPrefix(".") }.map { ["name": $0] }
    }
}
