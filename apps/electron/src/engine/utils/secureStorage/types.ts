// Stub: secure storage types for external builds

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SecureStorageData = Record<string, any>

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}
