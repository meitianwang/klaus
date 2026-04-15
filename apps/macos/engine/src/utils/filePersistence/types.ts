// Stub: File persistence types for external builds.

export const DEFAULT_UPLOAD_CONCURRENCY = 5
export const FILE_COUNT_LIMIT = 100
export const OUTPUTS_SUBDIR = 'outputs'

export type TurnStartTime = number

export interface PersistedFile {
  path: string
  fileId?: string
}

export interface FailedPersistence {
  path: string
  error: string
}

export interface FilesPersistedEventData {
  files: PersistedFile[]
  failed: FailedPersistence[]
  totalFiles: number
  totalBytes: number
  durationMs: number
}
