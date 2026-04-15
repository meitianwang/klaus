/**
 * Shim for @anthropic-ai/sandbox-runtime (unavailable internal package).
 * Provides no-op static methods that sandbox-adapter.ts forwards to.
 */

const noopConfig = {
  paths: [],
  patterns: [],
}

export class SandboxManager {
  static isSupportedPlatform(): boolean {
    return false
  }
  static checkDependencies(): { errors: string[]; warnings: string[] } {
    return { errors: ['sandbox-runtime not available'], warnings: [] }
  }
  static getFsReadConfig() {
    return noopConfig
  }
  static getFsWriteConfig() {
    return noopConfig
  }
  static getNetworkRestrictionConfig() {
    return { allowedHosts: [], blockedHosts: [] }
  }
  static getIgnoreViolations() {
    return { patterns: [] }
  }
  static getAllowUnixSockets() {
    return false
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
  static waitForNetworkInitialization() {
    return Promise.resolve()
  }
  static getSandboxViolationStore() {
    return new SandboxViolationStore()
  }
  static annotateStderrWithSandboxFailures(stderr: string) {
    return stderr
  }
  static cleanupAfterCommand() {}
  static async initialize() {}
  static configure() {}
}

export const SandboxRuntimeConfigSchema = {}

export class SandboxViolationStore {
  getViolations() {
    return []
  }
  clear() {}
}
