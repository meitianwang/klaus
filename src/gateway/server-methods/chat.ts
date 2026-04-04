import type { EngineEvent } from "../../agent-manager.js";
import { formatDisplayText, type InboundMessage, type MediaFile } from "../../message.js";
import type { Handler } from "../../types.js";
import { buildWebSessionKey, type WsEvent } from "../protocol.js";

function toolDisplay(toolName: string, args: unknown): Record<string, string> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const cmd = typeof a.command === "string" ? a.command : "";
  const path =
    typeof a.path === "string"
      ? a.path
      : typeof a.file_path === "string"
        ? a.file_path
        : "";
  const query =
    typeof a.query === "string"
      ? a.query
      : typeof a.pattern === "string"
        ? a.pattern
        : "";
  const name = toolName.toLowerCase();
  if (name === "bash" || name === "shell" || name === "execute" || name === "run_command") {
    return { style: "terminal", icon: "terminal", label: toolName, value: cmd || path };
  }
  if (name === "read" || name === "read_file" || name === "readfile") {
    return { style: "file", icon: "file", label: toolName, value: path };
  }
  if (name === "write" || name === "write_file" || name === "writefile" || name === "create") {
    return { style: "file", icon: "file-plus", label: toolName, value: path };
  }
  if (name === "edit" || name === "patch" || name === "replace") {
    return { style: "file", icon: "edit", label: toolName, value: path };
  }
  if (name === "search" || name === "grep" || name === "glob" || name === "find") {
    return { style: "search", icon: "search", label: toolName, value: query || path };
  }
  if (name === "web_search" || name === "fetch" || name === "http") {
    return { style: "default", icon: "globe", label: toolName, value: query };
  }
  if (name === "agent") {
    return { style: "default", icon: "agent", label: toolName, value: "" };
  }
  return { style: "default", icon: "tool", label: toolName, value: "" };
}

export function createGatewayAgentEventForwarder(params: {
  userId: string;
  sessionId: string;
  sendEvent: (userId: string, event: WsEvent) => void;
  onTextChunk?: (chunk: string) => void;
  onThinkingChunk?: (chunk: string) => void;
  onToolStart?: (params: {
    toolName: string;
    toolCallId: string;
    args: unknown;
  }) => void;
  onToolEnd?: (params: {
    toolName: string;
    toolCallId: string;
    isError: boolean;
  }) => void;
}): (event: EngineEvent) => void {
  return (event: EngineEvent) => {
    if (event.type === "text_delta") {
      params.onTextChunk?.(event.text);
      params.sendEvent(params.userId, {
        type: "stream",
        chunk: event.text,
        sessionId: params.sessionId,
      });
    }
    if (event.type === "thinking_delta") {
      params.onThinkingChunk?.(event.thinking);
      params.sendEvent(params.userId, {
        type: "thinking",
        chunk: event.thinking,
        sessionId: params.sessionId,
      });
    }
    if (event.type === "tool_start") {
      params.onToolStart?.({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: event.args,
      });
      params.sendEvent(params.userId, {
        type: "tool",
        data: {
          type: "tool_start",
          toolUseId: event.toolCallId,
          toolName: event.toolName,
          display: toolDisplay(event.toolName, event.args),
        },
        sessionId: params.sessionId,
      });
    }
    if (event.type === "tool_end") {
      params.onToolEnd?.({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
      });
      params.sendEvent(params.userId, {
        type: "tool",
        data: {
          type: "tool_result",
          toolUseId: event.toolCallId,
          isError: event.isError,
        },
        sessionId: params.sessionId,
      });
    }
    if (event.type === "context_collapse_stats") {
      params.sendEvent(params.userId, {
        type: "context_collapse",
        collapsedSpans: event.collapsedSpans,
        stagedSpans: event.stagedSpans,
        totalErrors: event.totalErrors,
        sessionId: params.sessionId,
      });
    }
    if (event.type === "requesting") {
      params.sendEvent(params.userId, {
        type: "session_lifecycle",
        event: "requesting",
        sessionId: params.sessionId,
      });
    }
    if (event.type === "tool_input_delta") {
      params.sendEvent(params.userId, {
        type: "tool",
        data: {
          type: "tool_input",
          toolUseId: event.toolCallId,
          delta: event.delta,
        },
        sessionId: params.sessionId,
      });
    }
    if (event.type === "progress") {
      params.sendEvent(params.userId, {
        type: "tool",
        data: {
          type: "tool_progress",
          toolUseId: event.toolCallId,
          content: event.content,
        },
        sessionId: params.sessionId,
      });
    }
    if (event.type === "api_retry") {
      params.sendEvent(params.userId, {
        type: "session_event",
        event: {
          type: "api_retry",
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          error: event.error,
          delayMs: event.delayMs,
        },
        sessionId: params.sessionId,
      });
    }
    if (event.type === "compact_boundary") {
      params.sendEvent(params.userId, {
        type: "session_lifecycle",
        event: "compact",
        sessionId: params.sessionId,
      });
    }
    if (event.type === "tombstone") {
      params.sendEvent(params.userId, {
        type: "session_event",
        event: {
          type: "tombstone",
          uuid: event.messageUuid,
        },
        sessionId: params.sessionId,
      });
    }
    if (event.type === "done") {
      params.sendEvent(params.userId, {
        type: "session_lifecycle",
        event: "done",
        sessionId: params.sessionId,
      });
    }
  };
}

async function appendGatewayUserTranscript(params: {
  message: InboundMessage;
  append: (sessionKey: string, role: "user" | "assistant", text: string) => Promise<void>;
}): Promise<void> {
  const display = formatDisplayText(params.message);
  if (!display) {
    return;
  }
  await params.append(params.message.sessionKey, "user", display);
}

async function appendGatewayAssistantTranscript(params: {
  sessionKey: string;
  reply: string;
  append: (sessionKey: string, role: "user" | "assistant", text: string) => Promise<void>;
}): Promise<void> {
  if (!params.reply) {
    return;
  }
  await params.append(params.sessionKey, "assistant", params.reply);
}

export async function processGatewayInboundMessage(params: {
  userId: string;
  sessionId: string;
  text: string;
  handler: Handler;
  media?: readonly MediaFile[];
  sendEvent: (userId: string, event: WsEvent) => void;
  appendTranscript?: (sessionKey: string, role: "user" | "assistant", text: string) => Promise<void>;
  onAttemptStart?: (sessionKey: string) => void;
  onAttemptComplete?: (sessionKey: string) => void;
  onAttemptError?: (sessionKey: string, error: unknown) => void;
  onUserMessage?: (sessionKey: string, display: string) => void;
  onAssistantMessage?: (sessionKey: string, reply: string) => void;
}): Promise<string | null> {
  const trimmedText = params.text.trim();
  if (!trimmedText && (!params.media || params.media.length === 0)) {
    return null;
  }

  const sessionKey = buildWebSessionKey(params.userId, params.sessionId);
  const hasMedia = Boolean(params.media && params.media.length > 0);
  const messageType =
    hasMedia && trimmedText
      ? "mixed"
      : hasMedia
        ? params.media?.[0]?.type === "image"
          ? "image"
          : "file"
        : "text";
  const message: InboundMessage = {
    sessionKey,
    text: trimmedText,
    messageType,
    chatType: "private",
    senderId: params.userId,
    ...(hasMedia ? { media: params.media } : {}),
  };

  const mediaLabel = hasMedia ? ` +${params.media?.length ?? 0} file(s)` : "";
  console.log(
    `[Gateway] Received (${params.userId.slice(0, 8)}): ${trimmedText.slice(0, 120)}${mediaLabel}`,
  );

  params.onAttemptStart?.(sessionKey);
  const userDisplay = formatDisplayText(message);
  if (userDisplay) {
    params.onUserMessage?.(sessionKey, userDisplay);
  }

  try {
    if (params.appendTranscript) {
      try {
        await appendGatewayUserTranscript({
          message,
          append: params.appendTranscript,
        });
      } catch (err) {
        console.error("[Gateway] Failed to append user transcript:", err);
      }
    }

    const reply = await params.handler(message);

    if (reply !== null) {
      if (params.appendTranscript) {
        try {
          await appendGatewayAssistantTranscript({
            sessionKey,
            reply,
            append: params.appendTranscript,
          });
        } catch (err) {
          console.error("[Gateway] Failed to append assistant transcript:", err);
        }
      }

      params.onAssistantMessage?.(sessionKey, reply);
      params.sendEvent(params.userId, {
        type: "message",
        text: reply,
        id: Date.now().toString(36),
        sessionId: params.sessionId,
      });
    }

    // Always send done signal so the UI unblocks even when reply is null
    // (The "done" EngineEvent from agent-manager should also fire via the forwarder,
    // but this serves as a fallback for non-engine handlers.)
    params.sendEvent(params.userId, {
      type: "session_lifecycle",
      event: "done",
      sessionId: params.sessionId,
    });

    params.onAttemptComplete?.(sessionKey);
    return reply;
  } catch (err) {
    params.onAttemptError?.(sessionKey, err);
    throw err;
  }
}
