export type QueueOperation = string

export interface QueueOperationMessage {
  type: 'queue-operation' | 'queue_operation'
  operation: string
  timestamp: string
  sessionId?: string
  content?: string
  [key: string]: unknown
}
