/**
 * Moonshot Video Description tool — sends video to Moonshot for AI description.
 * Ported from openclaw's media-understanding-provider.ts.
 */

import { Type, type Static } from "@sinclair/typebox";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, isAbsolute } from "node:path";
import type { AgentTool, AgentToolResult, ToolExecutionContext } from "../klaus-agent-compat.js";
import { fetchMoonshotApi } from "./moonshot-fetch.js";

const DEFAULT_MODEL = "kimi-k2.5";
const DEFAULT_PROMPT = "Describe the video.";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v"]);

const VideoParams = Type.Object({
  file_path: Type.String({ description: "Absolute path to the video file." }),
  prompt: Type.Optional(Type.String({ description: "Custom prompt for describing the video." })),
  mime: Type.Optional(Type.String({ description: "MIME type of the video (default: video/mp4)." })),
});

type VideoParams = Static<typeof VideoParams>;

type MoonshotVideoResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
      reasoning_content?: string;
    };
  }>;
};

function extractText(payload: MoonshotVideoResponse): string | null {
  const message = payload.choices?.[0]?.message;
  if (!message) return null;

  if (typeof message.content === "string" && message.content.trim()) {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }
  return null;
}

export function createMoonshotVideoTool(apiKey: string, baseUrl: string, model?: string): AgentTool {
  const videoModel = model || DEFAULT_MODEL;

  return {
    name: "moonshot_describe_video",
    label: "Moonshot Video Description",
    description: "Send a video file to Moonshot (Kimi) for AI-powered description and analysis.",
    parameters: VideoParams,
    async execute(
      _toolCallId: string,
      params: VideoParams,
      context: ToolExecutionContext,
    ): Promise<AgentToolResult> {
      const filePath = resolve(params.file_path);
      if (!isAbsolute(filePath) || filePath.includes("..")) {
        throw new Error("Invalid file path: must be an absolute path without '..'");
      }
      const ext = extname(filePath).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`Unsupported video extension: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`);
      }
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_FILE_SIZE / 1024 / 1024} MB`);
      }

      const buffer = await readFile(filePath);
      const mime = params.mime || "video/mp4";
      const prompt = params.prompt || DEFAULT_PROMPT;

      const payload = await fetchMoonshotApi<MoonshotVideoResponse>({
        baseUrl,
        path: "/chat/completions",
        apiKey,
        body: {
          model: videoModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "video_url",
                  video_url: { url: `data:${mime};base64,${buffer.toString("base64")}` },
                },
              ],
            },
          ],
        },
        signal: context.signal,
      });

      const text = extractText(payload);
      if (!text) {
        throw new Error("Moonshot video description response missing content");
      }

      return { content: [{ type: "text", text }] };
    },
  };
}
