// Stub: SDK runtime types for external builds.
// In the full build pipeline, these are the non-serializable types (callbacks, interfaces).

import type { z } from 'zod'

export type AnyZodRawShape = z.ZodRawShape
export type InferShape<T extends AnyZodRawShape> = z.infer<z.ZodObject<T>>

export type EffortLevel = 'low' | 'medium' | 'high'

export interface Options {
  [key: string]: unknown
}

export interface InternalOptions extends Options {
  [key: string]: unknown
}

export interface Query {
  [key: string]: unknown
}

export interface InternalQuery extends Query {
  [key: string]: unknown
}

export interface SDKSession {
  [key: string]: unknown
}

export interface SDKSessionOptions {
  [key: string]: unknown
}

export interface SessionMessage {
  [key: string]: unknown
}

export interface ListSessionsOptions {
  [key: string]: unknown
}

export interface GetSessionInfoOptions {
  [key: string]: unknown
}

export interface GetSessionMessagesOptions {
  [key: string]: unknown
}

export interface SessionMutationOptions {
  [key: string]: unknown
}

export interface ForkSessionOptions {
  [key: string]: unknown
}

export interface ForkSessionResult {
  [key: string]: unknown
}

export interface McpSdkServerConfigWithInstance {
  [key: string]: unknown
}

export interface SdkMcpToolDefinition<_Schema extends AnyZodRawShape = AnyZodRawShape> {
  [key: string]: unknown
}
