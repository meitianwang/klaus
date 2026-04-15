import Foundation

// MARK: - JSON Utility

/// Lightweight wrapper for heterogeneous JSON values in Codable contexts.
enum JSONValue: Codable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let v = try? container.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? container.decode(Int.self) {
            self = .int(v)
        } else if let v = try? container.decode(Double.self) {
            self = .double(v)
        } else if let v = try? container.decode(String.self) {
            self = .string(v)
        } else if let v = try? container.decode([JSONValue].self) {
            self = .array(v)
        } else if let v = try? container.decode([String: JSONValue].self) {
            self = .object(v)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        }
    }

    var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let v) = self { return v }
        return nil
    }
}

// MARK: - Stdin Messages (Swift → Engine)

/// User message sent to the engine via stdin.
struct SDKUserMessage: Codable, Sendable {
    let type: String = "user"
    let message: APIUserMessage
    let parent_tool_use_id: String? = nil

    init(content: String) {
        self.message = APIUserMessage(content: .text(content))
    }

    init(contentBlocks: [APIContentBlock]) {
        self.message = APIUserMessage(content: .blocks(contentBlocks))
    }
}

struct APIUserMessage: Codable, Sendable {
    let role: String = "user"
    let content: APIUserContent

    enum APIUserContent: Codable, Sendable {
        case text(String)
        case blocks([APIContentBlock])

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .text(let s): try container.encode(s)
            case .blocks(let b): try container.encode(b)
            }
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let s = try? container.decode(String.self) {
                self = .text(s)
            } else {
                self = .blocks(try container.decode([APIContentBlock].self))
            }
        }
    }
}

struct APIContentBlock: Codable, Sendable {
    let type: String
    // text content
    let text: String?
    // image content
    let source: ImageSource?

    struct ImageSource: Codable, Sendable {
        let type: String  // "base64"
        let media_type: String  // "image/png", etc.
        let data: String
    }

    static func text(_ text: String) -> APIContentBlock {
        APIContentBlock(type: "text", text: text, source: nil)
    }

    static func image(mediaType: String, base64Data: String) -> APIContentBlock {
        APIContentBlock(
            type: "image",
            text: nil,
            source: ImageSource(type: "base64", media_type: mediaType, data: base64Data)
        )
    }
}

/// Control response sent back to the engine (e.g., permission decision).
struct SDKControlResponse: Codable, Sendable {
    let type: String = "control_response"
    let response: ControlResponseInner

    enum ControlResponseInner: Codable, Sendable {
        case success(ControlSuccessResponse)
        case error(ControlErrorResponse)

        func encode(to encoder: Encoder) throws {
            switch self {
            case .success(let r): try r.encode(to: encoder)
            case .error(let r): try r.encode(to: encoder)
            }
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let subtype = try container.decode(String.self, forKey: .subtype)
            if subtype == "error" {
                self = .error(try ControlErrorResponse(from: decoder))
            } else {
                self = .success(try ControlSuccessResponse(from: decoder))
            }
        }

        private enum CodingKeys: String, CodingKey { case subtype }
    }
}

struct ControlSuccessResponse: Codable, Sendable {
    let subtype: String = "success"
    let request_id: String
    let response: PermissionResult?
}

struct ControlErrorResponse: Codable, Sendable {
    let subtype: String = "error"
    let request_id: String
    let error: String
}

// MARK: - Permission Types

enum PermissionResult: Codable, Sendable {
    case allow(PermissionAllow)
    case deny(PermissionDeny)

    func encode(to encoder: Encoder) throws {
        switch self {
        case .allow(let a): try a.encode(to: encoder)
        case .deny(let d): try d.encode(to: encoder)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let behavior = try container.decode(String.self, forKey: .behavior)
        if behavior == "deny" {
            self = .deny(try PermissionDeny(from: decoder))
        } else {
            self = .allow(try PermissionAllow(from: decoder))
        }
    }

    private enum CodingKeys: String, CodingKey { case behavior }
}

struct PermissionAllow: Codable, Sendable {
    let behavior: String = "allow"
    var updatedInput: [String: JSONValue]?
    var updatedPermissions: [PermissionUpdate]?
    var toolUseID: String?
    var decisionClassification: String?  // "user_temporary" | "user_permanent"
}

struct PermissionDeny: Codable, Sendable {
    let behavior: String = "deny"
    let message: String
    var interrupt: Bool?
    var toolUseID: String?
    var decisionClassification: String?  // "user_reject"
}

struct PermissionUpdate: Codable, Sendable {
    let type: String  // "addRules", "replaceRules", "removeRules", "setMode", "addDirectories"
    var rules: [PermissionRuleValue]?
    var behavior: String?
    var destination: String?  // "localSettings", "projectSettings"
    var mode: String?
    var directories: [String]?
}

struct PermissionRuleValue: Codable, Sendable {
    let tool_name: String?
    let command: String?
    let path: String?
}

// MARK: - Stdout Messages (Engine → Swift)

/// Top-level discriminated union for all engine output messages.
/// Decoded by reading the "type" field first.
enum EngineMessage: Sendable {
    case system(SystemInitMessage)
    case assistant(AssistantMessage)
    case user(UserToolResultMessage)
    case streamEvent(StreamEventMessage)
    case controlRequest(ControlRequestMessage)
    case result(ResultMessage)
    case keepAlive
    case unknown(type: String, raw: [String: JSONValue])

    static func decode(from data: Data) -> EngineMessage? {
        guard let json = try? JSONDecoder().decode([String: JSONValue].self, from: data),
              let typeVal = json["type"]?.stringValue else {
            return nil
        }

        switch typeVal {
        case "system":
            if let msg = try? JSONDecoder().decode(SystemInitMessage.self, from: data) {
                return .system(msg)
            }
        case "assistant":
            if let msg = try? JSONDecoder().decode(AssistantMessage.self, from: data) {
                return .assistant(msg)
            }
        case "user":
            if let msg = try? JSONDecoder().decode(UserToolResultMessage.self, from: data) {
                return .user(msg)
            }
        case "stream_event":
            if let msg = try? JSONDecoder().decode(StreamEventMessage.self, from: data) {
                return .streamEvent(msg)
            }
        case "control_request":
            if let msg = try? JSONDecoder().decode(ControlRequestMessage.self, from: data) {
                return .controlRequest(msg)
            }
        case "result":
            if let msg = try? JSONDecoder().decode(ResultMessage.self, from: data) {
                return .result(msg)
            }
        case "keep_alive":
            return .keepAlive
        default:
            break
        }

        return .unknown(type: typeVal, raw: json)
    }
}

// MARK: - System Init

struct SystemInitMessage: Codable, Sendable {
    let type: String  // "system"
    let subtype: String  // "init"
    let session_id: String
    let model: String
    let tools: [String]
    let cwd: String
    let claude_code_version: String
    let permissionMode: String?
    let apiKeySource: String?
    let mcp_servers: [MCPServerInfo]?
    let slash_commands: [String]?
    let skills: [String]?
    let agents: [String]?
    let uuid: String?

    struct MCPServerInfo: Codable, Sendable {
        let name: String
        let status: String
    }
}

// MARK: - Assistant Message

struct AssistantMessage: Codable, Sendable {
    let type: String  // "assistant"
    let message: AssistantMessageContent
    let parent_tool_use_id: String?
    let error: String?  // authentication_failed, billing_error, etc.
    let uuid: String
    let session_id: String
}

struct AssistantMessageContent: Codable, Sendable {
    let role: String  // "assistant"
    let content: [ContentBlock]?
    let model: String?
    let stop_reason: String?
    let usage: UsageInfo?
}

struct ContentBlock: Codable, Sendable {
    let type: String  // "text", "tool_use", "thinking"
    let text: String?
    let id: String?
    let name: String?  // tool name for tool_use
    let input: [String: JSONValue]?  // tool input for tool_use
    let thinking: String?  // thinking content
}

struct UsageInfo: Codable, Sendable {
    let input_tokens: Int?
    let output_tokens: Int?
    let cache_read_input_tokens: Int?
    let cache_creation_input_tokens: Int?
}

// MARK: - Stream Event

struct StreamEventMessage: Codable, Sendable {
    let type: String  // "stream_event"
    let event: RawStreamEvent
    let parent_tool_use_id: String?
    let uuid: String
    let session_id: String
}

/// Raw Anthropic API stream event — flexible decoder for varying shapes.
struct RawStreamEvent: Codable, Sendable {
    let type: String  // message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
    let index: Int?
    let message: AssistantMessageContent?  // for message_start
    let content_block: ContentBlock?  // for content_block_start
    let delta: StreamDelta?  // for content_block_delta, message_delta
    let usage: UsageInfo?  // for message_delta
}

struct StreamDelta: Codable, Sendable {
    let type: String?  // "text_delta", "thinking_delta", "input_json_delta"
    let text: String?
    let thinking: String?
    let partial_json: String?
    let stop_reason: String?  // for message_delta
}

// MARK: - Control Request (Permission Prompt)

struct ControlRequestMessage: Codable, Sendable {
    let type: String  // "control_request"
    let request_id: String
    let request: ControlRequestInner
}

struct ControlRequestInner: Codable, Sendable {
    let subtype: String  // "can_use_tool", "hook_callback", "elicitation", "mcp_message"
    // can_use_tool fields
    let tool_name: String?
    let input: [String: JSONValue]?
    let tool_use_id: String?
    let description: String?
    let display_name: String?
    let title: String?
    let permission_suggestions: [PermissionUpdate]?
    let agent_id: String?
}

// MARK: - Result Message

struct ResultMessage: Codable, Sendable {
    let type: String  // "result"
    let subtype: String  // "success", "error_during_execution", "error_max_turns", etc.
    let duration_ms: Double
    let duration_api_ms: Double?
    let is_error: Bool
    let num_turns: Int
    let result: String?
    let total_cost_usd: Double
    let stop_reason: String?
    let errors: [String]?
    let session_id: String
    let uuid: String
    let modelUsage: [String: ModelUsageInfo]?
}

struct ModelUsageInfo: Codable, Sendable {
    let inputTokens: Int?
    let outputTokens: Int?
    let cacheReadInputTokens: Int?
    let cacheCreationInputTokens: Int?
    let costUSD: Double?
}

// MARK: - User Message (Tool Result)

struct UserToolResultMessage: Codable, Sendable {
    let type: String  // "user"
    let message: UserToolResultContent
    let session_id: String?
    let uuid: String?

    struct UserToolResultContent: Codable, Sendable {
        let role: String  // "user"
        let content: [ToolResultBlock]?
    }

    struct ToolResultBlock: Codable, Sendable {
        let type: String  // "tool_result"
        let tool_use_id: String?
        let content: ToolResultContent?

        // Content can be a string or an array of blocks
        enum ToolResultContent: Codable, Sendable {
            case text(String)
            case blocks([ToolResultContentBlock])

            func encode(to encoder: Encoder) throws {
                var container = encoder.singleValueContainer()
                switch self {
                case .text(let s): try container.encode(s)
                case .blocks(let b): try container.encode(b)
                }
            }

            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let s = try? container.decode(String.self) {
                    self = .text(s)
                } else if let b = try? container.decode([ToolResultContentBlock].self) {
                    self = .blocks(b)
                } else {
                    self = .text("")
                }
            }

            var displayText: String {
                switch self {
                case .text(let s): return s
                case .blocks(let blocks):
                    return blocks.compactMap { block in
                        if block.type == "text" { return block.text }
                        return nil
                    }.joined(separator: "\n")
                }
            }
        }

        struct ToolResultContentBlock: Codable, Sendable {
            let type: String  // "text", "image"
            let text: String?
            let source: JSONValue?
        }
    }
}
