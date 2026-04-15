import Foundation
import SwiftUI

// MARK: - Chat Models

enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
}

enum MessageContentType: String, Codable, Sendable {
    case text
    case thinking
    case toolCall = "tool_call"
    case image
}

struct ChatMessageContent: Identifiable, Sendable {
    let id = UUID()
    let type: MessageContentType
    let text: String?
    let thinking: String?
    let toolName: String?
    let toolUseId: String?
    let arguments: String?
    var result: String?

    var imageData: Data?

    init(type: MessageContentType, text: String?, thinking: String?, toolName: String?, arguments: String?, toolUseId: String? = nil, result: String? = nil, imageData: Data? = nil) {
        self.type = type
        self.text = text
        self.thinking = thinking
        self.toolName = toolName
        self.arguments = arguments
        self.toolUseId = toolUseId
        self.result = result
        self.imageData = imageData
    }
}

struct ChatMessage: Identifiable, Sendable {
    let id: String
    let role: MessageRole
    var content: [ChatMessageContent]
    let timestamp: Date
    var isStreaming: Bool = false
    var costUSD: Double?

    var displayText: String {
        content.compactMap { $0.text }.joined()
    }

    var thinkingText: String? {
        let parts = content.filter { $0.type == .thinking }.compactMap { $0.thinking }
        return parts.isEmpty ? nil : parts.joined()
    }

    var toolCalls: [ChatMessageContent] {
        content.filter { $0.type == .toolCall }
    }
}

// MARK: - Session Model

struct ChatSession: Identifiable, Sendable, Codable {
    let id: String
    var title: String
    var messages: [ChatMessage] = []
    var model: String?
    var createdAt: Date = Date()
    var isActive: Bool = false

    enum CodingKeys: String, CodingKey {
        case id, title, model, createdAt, isActive
    }
}

// Make ChatMessage Codable for persistence (metadata only, not full content)
extension ChatMessage: Codable {
    enum CodingKeys: String, CodingKey {
        case id, role, timestamp, costUSD
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = try c.decode(MessageRole.self, forKey: .role)
        timestamp = try c.decode(Date.self, forKey: .timestamp)
        costUSD = try c.decodeIfPresent(Double.self, forKey: .costUSD)
        content = []
        isStreaming = false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(role, forKey: .role)
        try c.encode(timestamp, forKey: .timestamp)
        try c.encodeIfPresent(costUSD, forKey: .costUSD)
    }
}

// MARK: - Chat View Model

@MainActor
@Observable
final class ChatViewModel {
    var sessions: [ChatSession] = []
    var activeSessionId: String?
    var inputText = ""
    var isProcessing = false
    var currentModel: String?

    // Streaming state for the current assistant turn
    private var currentAssistantId: String?
    private var textBuffer = ""
    private var thinkingBuffer = ""
    private var toolCallsBuffer: [ChatMessageContent] = []
    private var currentToolName: String?
    private var currentToolUseId: String?
    private var currentToolInputJson: String = ""

    var activeSession: ChatSession? {
        sessions.first(where: { $0.id == activeSessionId })
    }

    var messages: [ChatMessage] {
        get { activeSession?.messages ?? [] }
        set {
            if let idx = sessions.firstIndex(where: { $0.id == activeSessionId }) {
                sessions[idx].messages = newValue
            }
        }
    }

    private static let sessionsFile: String = {
        let dir = KlausPaths.configDir
        return "\(dir)/mac-sessions.json"
    }()

    /// Attach to the engine's message stream. Call once on appear.
    func attach() {
        EngineProcess.shared.onMessage = { [weak self] message in
            self?.handleEngineMessage(message)
        }
        loadSessions()
    }

    func saveSessions() {
        // Save session metadata (titles, ids, model) — not full message content
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(sessions) {
            let dir = KlausPaths.configDir
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? data.write(to: URL(fileURLWithPath: Self.sessionsFile))
        }
    }

    private func loadSessions() {
        let url = URL(fileURLWithPath: Self.sessionsFile)
        guard let data = try? Data(contentsOf: url) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let saved = try? decoder.decode([ChatSession].self, from: data) {
            sessions = saved
            activeSessionId = saved.first(where: { $0.isActive })?.id ?? saved.first?.id
        }
    }

    func newSession() {
        let session = ChatSession(
            id: UUID().uuidString,
            title: "New Chat",
            isActive: true
        )
        // Deactivate previous
        for i in sessions.indices {
            sessions[i].isActive = false
        }
        sessions.insert(session, at: 0)
        activeSessionId = session.id
        resetStreamingState()
        saveSessions()

        // Restart engine for new session
        EngineProcess.shared.stop()
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            await MainActor.run {
                EngineProcess.shared.start()
            }
        }
    }

    func switchSession(_ id: String) {
        guard id != activeSessionId else { return }
        for i in sessions.indices {
            sessions[i].isActive = (sessions[i].id == id)
        }
        activeSessionId = id
        resetStreamingState()

        // Resume the session via engine
        EngineProcess.shared.stop()
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            await MainActor.run {
                EngineProcess.shared.start(resumeSessionId: id)
            }
        }
    }

    func deleteSession(_ id: String) {
        sessions.removeAll(where: { $0.id == id })
        if activeSessionId == id {
            activeSessionId = sessions.first?.id
            if let first = sessions.first {
                switchSession(first.id)
            }
        }
        saveSessions()
    }

    func send() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Auto-create session if none
        if activeSessionId == nil || sessions.isEmpty {
            let session = ChatSession(
                id: UUID().uuidString,
                title: String(text.prefix(40)),
                isActive: true
            )
            sessions.insert(session, at: 0)
            activeSessionId = session.id
        }

        // Update session title from first message
        if let idx = sessions.firstIndex(where: { $0.id == activeSessionId }),
           sessions[idx].messages.isEmpty {
            sessions[idx].title = String(text.prefix(40))
        }

        let userMessage = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: [ChatMessageContent(type: .text, text: text, thinking: nil, toolName: nil, arguments: nil)],
            timestamp: Date()
        )
        messages.append(userMessage)
        inputText = ""
        isProcessing = true
        resetStreamingState()

        // Create streaming placeholder
        let assistantId = UUID().uuidString
        currentAssistantId = assistantId
        messages.append(ChatMessage(
            id: assistantId,
            role: .assistant,
            content: [],
            timestamp: Date(),
            isStreaming: true
        ))

        EngineProcess.shared.sendUserMessage(text)
    }

    func interrupt() {
        EngineProcess.shared.interrupt()
        isProcessing = false
    }

    private func resetStreamingState() {
        textBuffer = ""
        thinkingBuffer = ""
        toolCallsBuffer = []
        currentToolName = nil
        currentToolUseId = nil
        currentToolInputJson = ""
        currentAssistantId = nil
    }

    // MARK: - Engine Message Handling

    private func handleEngineMessage(_ message: EngineMessage) {
        switch message {
        case .system(let init_msg):
            currentModel = init_msg.model
            // If engine returns a session id, map it to our active session
            if activeSessionId == nil {
                let session = ChatSession(
                    id: init_msg.session_id,
                    title: "Session",
                    model: init_msg.model,
                    isActive: true
                )
                sessions.insert(session, at: 0)
                activeSessionId = session.id
            }
            if let idx = sessions.firstIndex(where: { $0.id == activeSessionId }) {
                sessions[idx].model = init_msg.model
            }

        case .streamEvent(let event):
            handleStreamEvent(event)

        case .assistant(let msg):
            finalizeAssistantMessage(msg)

        case .result(let result):
            isProcessing = false
            if let idx = messages.lastIndex(where: { $0.role == .assistant }) {
                var msgs = messages
                msgs[idx].costUSD = result.total_cost_usd
                msgs[idx].isStreaming = false
                messages = msgs
            }

        case .user(let toolResult):
            handleToolResult(toolResult)

        case .controlRequest:
            break

        case .keepAlive, .unknown:
            break
        }
    }

    private func handleStreamEvent(_ event: StreamEventMessage) {
        let rawEvent = event.event

        switch rawEvent.type {
        case "message_start":
            if currentAssistantId == nil {
                let id = UUID().uuidString
                currentAssistantId = id
                messages.append(ChatMessage(
                    id: id, role: .assistant, content: [],
                    timestamp: Date(), isStreaming: true
                ))
            }

        case "content_block_start":
            if let block = rawEvent.content_block {
                if block.type == "tool_use" {
                    currentToolName = block.name
                    currentToolUseId = block.id
                    currentToolInputJson = ""
                }
            }

        case "content_block_delta":
            if let delta = rawEvent.delta {
                switch delta.type {
                case "text_delta":
                    if let text = delta.text {
                        textBuffer += text
                        updateStreamingMessage()
                    }
                case "thinking_delta":
                    if let thinking = delta.thinking {
                        thinkingBuffer += thinking
                        updateStreamingMessage()
                    }
                case "input_json_delta":
                    if let json = delta.partial_json {
                        currentToolInputJson += json
                    }
                default:
                    break
                }
            }

        case "content_block_stop":
            if let toolName = currentToolName {
                toolCallsBuffer.append(ChatMessageContent(
                    type: .toolCall, text: nil, thinking: nil,
                    toolName: toolName,
                    arguments: currentToolInputJson.isEmpty ? nil : currentToolInputJson,
                    toolUseId: currentToolUseId
                ))
                currentToolName = nil
                currentToolUseId = nil
                currentToolInputJson = ""
                updateStreamingMessage()
            }

        default:
            break
        }
    }

    private func updateStreamingMessage() {
        guard let id = currentAssistantId else { return }
        var msgs = messages
        guard let idx = msgs.firstIndex(where: { $0.id == id }) else { return }

        var content: [ChatMessageContent] = []
        content.append(contentsOf: toolCallsBuffer)

        if let toolName = currentToolName {
            content.append(ChatMessageContent(
                type: .toolCall, text: nil, thinking: nil,
                toolName: toolName, arguments: currentToolInputJson.isEmpty ? nil : currentToolInputJson
            ))
        }

        if !thinkingBuffer.isEmpty {
            content.append(ChatMessageContent(
                type: .thinking, text: nil, thinking: thinkingBuffer,
                toolName: nil, arguments: nil
            ))
        }

        if !textBuffer.isEmpty {
            content.append(ChatMessageContent(
                type: .text, text: textBuffer, thinking: nil,
                toolName: nil, arguments: nil
            ))
        }

        msgs[idx] = ChatMessage(
            id: id, role: .assistant, content: content,
            timestamp: msgs[idx].timestamp, isStreaming: true
        )
        messages = msgs
    }

    private func finalizeAssistantMessage(_ msg: AssistantMessage) {
        guard let id = currentAssistantId else { return }
        var msgs = messages
        guard let idx = msgs.firstIndex(where: { $0.id == id }) else { return }

        var content: [ChatMessageContent] = []
        if let blocks = msg.message.content {
            for block in blocks {
                switch block.type {
                case "text":
                    content.append(ChatMessageContent(
                        type: .text, text: block.text, thinking: nil,
                        toolName: nil, arguments: nil
                    ))
                case "thinking":
                    content.append(ChatMessageContent(
                        type: .thinking, text: nil, thinking: block.thinking ?? block.text,
                        toolName: nil, arguments: nil
                    ))
                case "tool_use":
                    let args = block.input.map { dict -> String in
                        let data = try? JSONEncoder().encode(dict)
                        return data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                    }
                    content.append(ChatMessageContent(
                        type: .toolCall, text: nil, thinking: nil,
                        toolName: block.name, arguments: args,
                        toolUseId: block.id
                    ))
                default:
                    break
                }
            }
        }

        msgs[idx] = ChatMessage(
            id: id, role: .assistant, content: content,
            timestamp: Date(), isStreaming: false
        )
        messages = msgs
        currentAssistantId = nil
        textBuffer = ""
        thinkingBuffer = ""
        toolCallsBuffer = []
        currentToolName = nil
        currentToolUseId = nil
        currentToolInputJson = ""
    }

    private func handleToolResult(_ msg: UserToolResultMessage) {
        guard let blocks = msg.message.content else { return }
        var msgs = messages

        for block in blocks where block.type == "tool_result" {
            guard let toolUseId = block.tool_use_id else { continue }
            let resultText = block.content?.displayText ?? ""

            // Find the assistant message containing the matching tool_call
            for i in msgs.indices.reversed() where msgs[i].role == .assistant {
                for j in msgs[i].content.indices {
                    if msgs[i].content[j].type == .toolCall,
                       msgs[i].content[j].toolUseId == toolUseId {
                        msgs[i].content[j].result = resultText
                    }
                }

                // Extract images from tool result content
                if case .blocks(let contentBlocks) = block.content {
                    for cb in contentBlocks where cb.type == "image" {
                        if case .object(let sourceObj) = cb.source,
                           let dataVal = sourceObj["data"]?.stringValue,
                           let imageData = Data(base64Encoded: dataVal) {
                            msgs[i].content.append(ChatMessageContent(
                                type: .image, text: nil, thinking: nil,
                                toolName: nil, arguments: nil,
                                imageData: imageData
                            ))
                        }
                    }
                }
            }
        }

        messages = msgs
    }
}

// MARK: - Main App View (Sidebar + Chat)

struct NativeChatView: View {
    @State private var viewModel = ChatViewModel()
    @State private var columnVisibility: NavigationSplitViewVisibility = .doubleColumn

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(viewModel: viewModel)
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        } detail: {
            ChatDetailView(viewModel: viewModel)
        }
        .onAppear {
            viewModel.attach()
        }
    }
}

// MARK: - Sidebar

struct SidebarView: View {
    @Bindable var viewModel: ChatViewModel
    @State private var searchText = ""

    private var filteredSessions: [ChatSession] {
        if searchText.isEmpty {
            return viewModel.sessions
        }
        let query = searchText.lowercased()
        return viewModel.sessions.filter { session in
            session.title.lowercased().contains(query) ||
            (session.model ?? "").lowercased().contains(query) ||
            session.messages.contains(where: { $0.displayText.lowercased().contains(query) })
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // New chat button
            Button {
                viewModel.newSession()
            } label: {
                Label(L10n.newChat, systemImage: "plus.message")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            .padding(.top, 8)

            // Search
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.tertiary)
                TextField(L10n.search, text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.06))
            .cornerRadius(8)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)

            Divider()

            // Session list
            if filteredSessions.isEmpty {
                ContentUnavailableView {
                    Label(L10n.noConversations, systemImage: "bubble.left.and.bubble.right")
                } description: {
                    Text(L10n.startNewChat)
                }
                .frame(maxHeight: .infinity)
            } else {
                List(selection: Binding(
                    get: { viewModel.activeSessionId },
                    set: { id in
                        if let id { viewModel.switchSession(id) }
                    }
                )) {
                    ForEach(filteredSessions) { session in
                        SessionRowView(session: session)
                            .tag(session.id)
                            .contextMenu {
                                Button(L10n.delete, role: .destructive) {
                                    viewModel.deleteSession(session.id)
                                }
                            }
                    }
                }
                .listStyle(.sidebar)
            }

            // Engine status footer
            Divider()
            HStack(spacing: 6) {
                Circle()
                    .fill(engineStatusColor)
                    .frame(width: 8, height: 8)
                Text(viewModel.currentModel ?? L10n.noModel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    private var engineStatusColor: Color {
        switch EngineProcess.shared.status {
        case .running: .green
        case .starting: .orange
        case .failed: .red
        default: .secondary
        }
    }
}

struct SessionRowView: View {
    let session: ChatSession

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(session.title)
                .font(.subheadline)
                .lineLimit(1)
            Text(session.createdAt, style: .relative)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Chat Detail

struct ChatDetailView: View {
    @Bindable var viewModel: ChatViewModel
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Messages area
            if viewModel.messages.isEmpty && !viewModel.isProcessing {
                WelcomeView()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(viewModel.messages) { message in
                                MessageView(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding(20)
                    }
                    .onChange(of: viewModel.messages.count) { _, _ in
                        scrollToBottom(proxy)
                    }
                    .onChange(of: viewModel.messages.last?.displayText) { _, _ in
                        scrollToBottom(proxy)
                    }
                }
            }

            Divider()

            // Input area
            InputBarView(viewModel: viewModel, isInputFocused: $isInputFocused)
        }
        .onAppear { isInputFocused = true }
        .onDrop(of: [.fileURL, .image], isTargeted: nil) { providers in
            handleDrop(providers)
            return true
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                if let model = viewModel.currentModel {
                    Text(model)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        if let last = viewModel.messages.last {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier("public.file-url") {
                provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { item, _ in
                    guard let data = item as? Data,
                          let url = URL(dataRepresentation: data, relativeTo: nil) else { return }
                    Task { @MainActor in
                        // Send file path as text to the engine
                        let text = "I'm sharing this file: \(url.path)"
                        viewModel.inputText = text
                    }
                }
            } else if provider.canLoadObject(ofClass: NSImage.self) {
                provider.loadObject(ofClass: NSImage.self) { image, _ in
                    guard let nsImage = image as? NSImage,
                          let tiffData = nsImage.tiffRepresentation,
                          let bitmap = NSBitmapImageRep(data: tiffData),
                          let pngData = bitmap.representation(using: .png, properties: [:]) else { return }
                    Task { @MainActor in
                        let base64 = pngData.base64EncodedString()
                        let blocks: [APIContentBlock] = [
                            .image(mediaType: "image/png", base64Data: base64),
                            .text("What's in this image?")
                        ]
                        EngineProcess.shared.sendUserMessage(blocks: blocks)
                    }
                }
            }
        }
    }
}

// MARK: - Welcome Screen

struct WelcomeView: View {
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "brain.head.profile")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text(L10n.welcomeTitle)
                .font(.largeTitle.weight(.semibold))
            Text(L10n.welcomeSubtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Input Bar

struct InputBarView: View {
    @Bindable var viewModel: ChatViewModel
    var isInputFocused: FocusState<Bool>.Binding
    @State private var attachedFiles: [AttachedFile] = []

    var body: some View {
        VStack(spacing: 0) {
            // Attached files preview
            if !attachedFiles.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachedFiles) { file in
                            AttachedFileChip(file: file) {
                                attachedFiles.removeAll(where: { $0.id == file.id })
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                // Attachment button
                Button {
                    pickFiles()
                } label: {
                    Image(systemName: "paperclip")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)

                // Text input
                TextField(L10n.messageKlaus, text: $viewModel.inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused(isInputFocused)
                    .onSubmit {
                        if !NSEvent.modifierFlags.contains(.shift) {
                            sendIfReady()
                        }
                    }

                // Send / Stop
                Button {
                    if viewModel.isProcessing {
                        viewModel.interrupt()
                    } else {
                        sendIfReady()
                    }
                } label: {
                    Image(systemName: viewModel.isProcessing ? "stop.circle.fill" : "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(
                            viewModel.isProcessing ? Color.red :
                            (hasContent ? Color.accentColor : Color.secondary)
                        )
                }
                .buttonStyle(.plain)
                .disabled(!hasContent && !viewModel.isProcessing)
                .keyboardShortcut(.return, modifiers: [])
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private var hasContent: Bool {
        !viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachedFiles.isEmpty
    }

    private func sendIfReady() {
        guard hasContent else { return }

        // If we have attachments, build content blocks
        if !attachedFiles.isEmpty {
            var blocks: [APIContentBlock] = []

            // Add images as content blocks
            for file in attachedFiles {
                if file.isImage, let data = try? Data(contentsOf: file.url) {
                    let base64 = data.base64EncodedString()
                    blocks.append(.image(mediaType: file.mimeType, base64Data: base64))
                }
            }

            // Add text
            let text = viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                blocks.append(.text(text))
            }

            // Add non-image files as text mentioning the path
            for file in attachedFiles where !file.isImage {
                blocks.append(.text("[Attached file: \(file.url.path)]"))
            }

            if !blocks.isEmpty {
                // Manually add user message and send
                let userMessage = ChatMessage(
                    id: UUID().uuidString,
                    role: .user,
                    content: [ChatMessageContent(
                        type: .text,
                        text: text.isEmpty ? "See attached files" : text,
                        thinking: nil, toolName: nil, arguments: nil
                    )],
                    timestamp: Date()
                )
                viewModel.messages.append(userMessage)
                viewModel.inputText = ""
                viewModel.isProcessing = true

                let assistantId = UUID().uuidString
                viewModel.messages.append(ChatMessage(
                    id: assistantId, role: .assistant, content: [],
                    timestamp: Date(), isStreaming: true
                ))

                EngineProcess.shared.sendUserMessage(blocks: blocks)
            }

            attachedFiles.removeAll()
        } else {
            viewModel.send()
        }
    }

    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image, .pdf, .plainText, .sourceCode, .json, .xml, .data]

        if panel.runModal() == .OK {
            for url in panel.urls {
                attachedFiles.append(AttachedFile(url: url))
            }
        }
    }
}

// MARK: - Attachment Types

struct AttachedFile: Identifiable {
    let id = UUID()
    let url: URL

    var name: String { url.lastPathComponent }

    var isImage: Bool {
        let ext = url.pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"].contains(ext)
    }

    var mimeType: String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "bmp": return "image/bmp"
        case "tiff": return "image/tiff"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }
}

struct AttachedFileChip: View {
    let file: AttachedFile
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: file.isImage ? "photo" : "doc")
                .font(.caption2)
            Text(file.name)
                .font(.caption)
                .lineLimit(1)
            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.secondary.opacity(0.1))
        .clipShape(Capsule())
    }
}

// MARK: - Message View

struct MessageView: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Avatar
            avatar
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 6) {
                // Role label
                Text(message.role == .user ? L10n.you : "Klaus")
                    .font(.subheadline.weight(.semibold))

                // Tool calls
                ForEach(message.toolCalls) { tool in
                    ToolCallView(tool: tool)
                }

                // Thinking
                if let thinking = message.thinkingText, !thinking.isEmpty {
                    ThinkingView(text: thinking)
                }

                // Images
                ForEach(message.content.filter { $0.type == .image }) { imageContent in
                    if let data = imageContent.imageData, let nsImage = NSImage(data: data) {
                        Image(nsImage: nsImage)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 400, maxHeight: 300)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }

                // Main text with markdown
                if !message.displayText.isEmpty {
                    MarkdownTextView(text: message.displayText)
                }

                // Streaming indicator
                if message.isStreaming && message.displayText.isEmpty && message.toolCalls.isEmpty {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text(L10n.thinking)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Cost
                if let cost = message.costUSD, cost > 0 {
                    Text(String(format: "$%.4f", cost))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var avatar: some View {
        if message.role == .user {
            Circle()
                .fill(Color.blue.opacity(0.15))
                .overlay(
                    Image(systemName: "person.fill")
                        .font(.caption)
                        .foregroundStyle(.blue)
                )
        } else {
            Circle()
                .fill(Color.purple.opacity(0.15))
                .overlay(
                    Image(systemName: "brain.head.profile")
                        .font(.caption)
                        .foregroundStyle(.purple)
                )
        }
    }
}

// MARK: - Markdown Text View

/// Renders markdown text with support for fenced code blocks, inline markdown,
/// and proper formatting. Splits text into segments and renders each appropriately.
struct MarkdownTextView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .text(let content):
                    if !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(parseInlineMarkdown(content))
                            .textSelection(.enabled)
                            .font(.body)
                    }
                case .codeBlock(let language, let code):
                    CodeBlockView(language: language, code: code)
                }
            }
        }
    }

    // MARK: - Segment Parsing

    private enum Segment {
        case text(String)
        case codeBlock(language: String?, code: String)
    }

    private var segments: [Segment] {
        var result: [Segment] = []
        var remaining = text[text.startIndex...]
        let fencePattern = "```"

        while let fenceStart = remaining.range(of: fencePattern) {
            // Text before the fence
            let before = String(remaining[remaining.startIndex..<fenceStart.lowerBound])
            if !before.isEmpty {
                result.append(.text(before))
            }

            // Find end of opening fence line (language tag)
            let afterFence = remaining[fenceStart.upperBound...]
            let language: String?
            let codeStart: Substring.Index

            if let newline = afterFence.firstIndex(of: "\n") {
                let tag = afterFence[afterFence.startIndex..<newline]
                    .trimmingCharacters(in: .whitespaces)
                language = tag.isEmpty ? nil : tag
                codeStart = afterFence.index(after: newline)
            } else {
                language = nil
                codeStart = afterFence.startIndex
            }

            // Find closing fence
            let codeRegion = remaining[codeStart...]
            if let fenceEnd = codeRegion.range(of: fencePattern) {
                let code = String(codeRegion[codeRegion.startIndex..<fenceEnd.lowerBound])
                // Trim trailing newline from code
                let trimmed = code.hasSuffix("\n") ? String(code.dropLast()) : code
                result.append(.codeBlock(language: language, code: trimmed))

                // Skip past closing fence + optional newline
                var next = fenceEnd.upperBound
                if next < remaining.endIndex && remaining[next] == "\n" {
                    next = remaining.index(after: next)
                }
                remaining = remaining[next...]
            } else {
                // No closing fence — treat rest as code block
                let code = String(codeRegion)
                result.append(.codeBlock(language: language, code: code))
                remaining = remaining[remaining.endIndex...]
            }
        }

        // Remaining text
        if !remaining.isEmpty {
            result.append(.text(String(remaining)))
        }

        return result
    }

    private func parseInlineMarkdown(_ text: String) -> AttributedString {
        if let attributed = try? AttributedString(markdown: text, options: .init(
            allowsExtendedAttributes: true,
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )) {
            return attributed
        }
        return AttributedString(text)
    }
}

// MARK: - Code Block View

struct CodeBlockView: View {
    let language: String?
    let code: String
    @State private var isCopied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header with language tag and copy button
            HStack {
                if let lang = language, !lang.isEmpty {
                    Text(lang)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    isCopied = true
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        await MainActor.run { isCopied = false }
                    }
                } label: {
                    Label(
                        isCopied ? L10n.copied : L10n.copy,
                        systemImage: isCopied ? "checkmark" : "doc.on.doc"
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.08))

            Divider()

            // Code content with syntax highlighting
            ScrollView(.horizontal, showsIndicators: false) {
                Text(highlightedCode)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.15), lineWidth: 1)
        )
    }

    private var highlightedCode: AttributedString {
        SyntaxHighlighter.highlight(code, language: language)
    }
}

// MARK: - Syntax Highlighter

enum SyntaxHighlighter {
    // Color palette
    private static let keywordColor = Color.pink
    private static let stringColor = Color.red
    private static let commentColor = Color(nsColor: .systemGreen).opacity(0.8)
    private static let numberColor = Color.cyan
    private static let typeColor = Color.purple
    private static let functionColor = Color.blue

    private static let keywords: [String: Set<String>] = [
        "swift": ["import", "func", "var", "let", "class", "struct", "enum", "protocol", "extension",
                  "if", "else", "guard", "switch", "case", "default", "for", "while", "repeat",
                  "return", "throw", "throws", "try", "catch", "async", "await", "in",
                  "private", "public", "internal", "fileprivate", "open", "static", "final",
                  "self", "Self", "super", "nil", "true", "false", "some", "any"],
        "typescript": ["import", "export", "from", "const", "let", "var", "function", "class",
                       "interface", "type", "enum", "extends", "implements", "new", "this",
                       "if", "else", "for", "while", "do", "switch", "case", "default",
                       "return", "throw", "try", "catch", "finally", "async", "await",
                       "true", "false", "null", "undefined", "of", "in", "typeof", "instanceof"],
        "javascript": ["import", "export", "from", "const", "let", "var", "function", "class",
                       "extends", "new", "this", "if", "else", "for", "while", "do",
                       "switch", "case", "default", "return", "throw", "try", "catch",
                       "finally", "async", "await", "true", "false", "null", "undefined"],
        "python": ["import", "from", "def", "class", "if", "elif", "else", "for", "while",
                   "return", "yield", "raise", "try", "except", "finally", "with", "as",
                   "lambda", "pass", "break", "continue", "and", "or", "not", "in", "is",
                   "True", "False", "None", "self", "async", "await", "global", "nonlocal"],
        "rust": ["fn", "let", "mut", "const", "static", "struct", "enum", "impl", "trait",
                 "use", "mod", "pub", "crate", "super", "self", "Self", "if", "else",
                 "match", "for", "while", "loop", "return", "break", "continue",
                 "async", "await", "move", "where", "true", "false", "Some", "None", "Ok", "Err"],
        "go": ["package", "import", "func", "var", "const", "type", "struct", "interface",
               "map", "chan", "if", "else", "for", "range", "switch", "case", "default",
               "return", "go", "defer", "select", "break", "continue", "fallthrough",
               "true", "false", "nil", "make", "new", "len", "cap", "append"],
        "bash": ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case",
                 "esac", "function", "return", "exit", "echo", "export", "local", "readonly",
                 "set", "unset", "true", "false", "in"],
    ]

    static func highlight(_ code: String, language: String?) -> AttributedString {
        var result = AttributedString(code)

        let lang = normalizeLanguage(language)
        let langKeywords = keywords[lang] ?? keywords["typescript"]!

        // Highlight strings (double and single quoted)
        highlightPattern(&result, pattern: #""[^"\\]*(?:\\.[^"\\]*)*""#, color: stringColor)
        highlightPattern(&result, pattern: #"'[^'\\]*(?:\\.[^'\\]*)*'"#, color: stringColor)
        // Template literals
        highlightPattern(&result, pattern: #"`[^`]*`"#, color: stringColor)

        // Highlight comments (// and #)
        highlightPattern(&result, pattern: #"//[^\n]*"#, color: commentColor)
        highlightPattern(&result, pattern: #"#[^\n]*"#, color: commentColor)

        // Highlight numbers
        highlightPattern(&result, pattern: #"\b\d+(\.\d+)?\b"#, color: numberColor)

        // Highlight keywords (word boundary match)
        for keyword in langKeywords {
            highlightPattern(&result, pattern: "\\b\(NSRegularExpression.escapedPattern(for: keyword))\\b", color: keywordColor)
        }

        return result
    }

    private static func highlightPattern(_ attributed: inout AttributedString, pattern: String, color: Color) {
        let plainString = String(attributed.characters)
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        let matches = regex.matches(in: plainString, range: NSRange(plainString.startIndex..., in: plainString))

        for match in matches {
            guard let range = Range(match.range, in: plainString) else { continue }
            let lower = AttributedString.Index(range.lowerBound, within: attributed)
            let upper = AttributedString.Index(range.upperBound, within: attributed)
            guard let lower, let upper else { continue }
            attributed[lower..<upper].foregroundColor = color
        }
    }

    private static func normalizeLanguage(_ lang: String?) -> String {
        guard let lang = lang?.lowercased().trimmingCharacters(in: .whitespaces) else { return "typescript" }
        switch lang {
        case "ts", "tsx", "typescript": return "typescript"
        case "js", "jsx", "javascript": return "javascript"
        case "py", "python", "python3": return "python"
        case "rs", "rust": return "rust"
        case "go", "golang": return "go"
        case "sh", "bash", "zsh", "shell": return "bash"
        case "swift": return "swift"
        default: return lang
        }
    }
}

// MARK: - Tool Call View

struct ToolCallView: View {
    let tool: ChatMessageContent
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: toolIcon)
                        .font(.caption)
                        .foregroundStyle(toolColor)
                    Text(tool.toolName ?? "Tool")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.primary)
                    if let summary = toolSummary {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if tool.result != nil {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.green)
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)

            // Expanded content: input + result
            if isExpanded {
                // Input arguments
                if let args = tool.arguments, !args.isEmpty {
                    Divider()
                    Text(L10n.input)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 10)
                        .padding(.top, 6)
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(formatArguments(args))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .padding(.horizontal, 10)
                            .padding(.bottom, 6)
                    }
                    .frame(maxHeight: 150)
                }

                // Tool result output
                if let result = tool.result, !result.isEmpty {
                    Divider()
                    Text(L10n.output)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 10)
                        .padding(.top, 6)
                    ScrollView([.horizontal, .vertical], showsIndicators: true) {
                        Text(result)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                            .padding(.horizontal, 10)
                            .padding(.bottom, 6)
                    }
                    .frame(maxHeight: 300)
                }
            }
        }
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.12), lineWidth: 1)
        )
    }

    private var toolIcon: String {
        switch tool.toolName {
        case "Bash": return "terminal"
        case "Read": return "doc.text"
        case "Write": return "doc.badge.plus"
        case "Edit": return "pencil.line"
        case "Grep": return "magnifyingglass"
        case "Glob": return "folder.badge.magnifyingglass"
        case "Agent": return "person.2"
        case "WebFetch": return "globe"
        case "WebSearch": return "magnifyingglass.circle"
        default: return "wrench"
        }
    }

    private var toolColor: Color {
        switch tool.toolName {
        case "Bash": return .orange
        case "Read": return .blue
        case "Write", "Edit": return .green
        case "Grep", "Glob": return .purple
        case "Agent": return .cyan
        case "WebFetch", "WebSearch": return .indigo
        default: return .secondary
        }
    }

    private var toolSummary: String? {
        guard let args = tool.arguments else { return nil }
        let name = tool.toolName ?? ""
        switch name {
        case "Bash":
            return extractField(args, "command").map { cmd in
                String(cmd.prefix(80))
            }
        case "Read":
            return extractField(args, "file_path")
        case "Write":
            return extractField(args, "file_path")
        case "Edit":
            return extractField(args, "file_path")
        case "Grep":
            return extractField(args, "pattern")
        case "Glob":
            return extractField(args, "pattern")
        case "WebFetch":
            return extractField(args, "url")
        default:
            return nil
        }
    }

    private func extractField(_ json: String, _ field: String) -> String? {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = obj[field] as? String else {
            return nil
        }
        return value
    }

    private func formatArguments(_ json: String) -> String {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data, options: []),
              let pretty = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
              let str = String(data: pretty, encoding: .utf8) else {
            return json
        }
        return str
    }
}

// MARK: - Thinking View

struct ThinkingView: View {
    let text: String
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text(L10n.thinkingLabel)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider()
                Text(text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxHeight: 300)
            }
        }
        .background(Color.orange.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.orange.opacity(0.15), lineWidth: 1)
        )
    }
}
