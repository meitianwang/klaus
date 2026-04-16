/**
 * Shim for @anthropic-ai/sandbox-runtime (unavailable internal package).
 * Provides no-op static methods that sandbox-adapter.ts forwards to.
 */

// Type stubs for sandbox-runtime types
export type FsReadRestrictionConfig = {
  paths?: string[]
  patterns?: string[]
  allowOnly?: string[]
  denyOnly?: string[]
  denyWithinAllow?: string[]
  allowWithinDeny?: string[]
}
export type FsWriteRestrictionConfig = {
  paths?: string[]
  patterns?: string[]
  allowOnly?: string[]
  denyWithinAllow?: string[]
}
export type IgnoreViolationsConfig = Record<string, string[]>
export type NetworkHostPattern = { host: string; port?: number; [key: string]: unknown }
export type NetworkRestrictionConfig = {
  allowedHosts?: string[]
  deniedHosts?: string[]
  blockedHosts?: string[]
}
export type SandboxAskCallback = (...args: unknown[]) => Promise<boolean>
export type SandboxDependencyCheck = { errors: string[]; warnings: string[] }
export type SandboxRuntimeConfig = Record<string, unknown>
export type SandboxViolationEvent = unknown

const noopConfig = {
  paths: [],
  patterns: [],
}

export class SandboxManager {
  static isSupportedPlatform(): boolean {
    return false
  }
  static checkDependencies(..._args: any[]): { errors: string[]; warnings: string[] } {
    return { errors: ['sandbox-runtime not available'], warnings: [] }
  }
  static getFsReadConfig(): {
    paths: string[]
    patterns: string[]
    allowOnly?: string[]
    denyWithinAllow?: string[]
    allowWithinDeny?: string[]
  } {
    return noopConfig
  }
  static getFsWriteConfig(): {
    paths: string[]
    patterns: string[]
    allowOnly?: string[]
    denyWithinAllow?: string[]
  } {
    return noopConfig
  }
  static getNetworkRestrictionConfig(): {
    allowedHosts: string[]
    deniedHosts: string[]
    blockedHosts: string[]
  } {
    return { allowedHosts: [], deniedHosts: [], blockedHosts: [] }
  }
  static getIgnoreViolations() {
    return { patterns: [] }
  }
  static getAllowUnixSockets(): string[] | undefined {
    return undefined
  }
  static getAllowLocalBinding() {
    return false
  }
  static getEnableWeakerNestedSandbox() {
    return false
  }
  static getProxyPort() {
    return undefined
  }
  static getSocksProxyPort() {
    return undefined
  }
  static getLinuxHttpSocketPath() {
    return undefined
  }
  static getLinuxSocksSocketPath() {
    return undefined
  }
  static waitForNetworkInitialization(): Promise<boolean> {
    return Promise.resolve(false)
  }
  static getSandboxViolationStore() {
    return new SandboxViolationStore()
  }
  static annotateStderrWithSandboxFailures(stderr: string) {
    return stderr
  }
  static cleanupAfterCommand() {}
  static async initialize(..._args: any[]) {}
  static configure() {}
  static wrapWithSandbox(
    command: string,
    _binShell?: string,
    _customConfig?: unknown,
    _abortSignal?: AbortSignal,
  ): string {
    return command
  }
  static updateConfig(_config?: unknown): void {}
  static reset(): void {}
}

export const SandboxRuntimeConfigSchema = {}

export class SandboxViolationStore {
  getViolations() {
    return []
  }
  clear() {}
}
