export interface Continue {
  reason: string
  [key: string]: unknown
}

export interface Terminal {
  reason: string
  error?: unknown
  turnCount?: number
  [key: string]: unknown
}
