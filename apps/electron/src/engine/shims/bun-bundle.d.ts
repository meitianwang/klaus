/**
 * Type declaration for bun:bundle module.
 *
 * In production builds, bun's bundler evaluates feature() at compile time
 * and performs dead code elimination. In dev mode, this shim makes all
 * features return false by default (external/open-source build behavior).
 */
declare module "bun:bundle" {
  /**
   * Compile-time feature flag. Returns true if the named feature is enabled
   * in the current build configuration.
   *
   * Known features:
   * - ABLATION_BASELINE, BUDDY, BRIDGE_MODE, DAEMON, BG_SESSIONS
   * - TEMPLATES, BYOC_ENVIRONMENT_RUNNER, SELF_HOSTED_RUNNER
   * - CHICAGO_MCP, DUMP_SYSTEM_PROMPT
   * - PROACTIVE, KAIROS, KAIROS_PUSH_NOTIFICATION, KAIROS_GITHUB_WEBHOOKS
   * - AGENT_TRIGGERS, AGENT_TRIGGERS_REMOTE, MONITOR_TOOL
   * - COORDINATOR_MODE, UDS_INBOX, WORKFLOW_SCRIPTS
   * - CONTEXT_COLLAPSE, HISTORY_SNIP, OVERFLOW_TEST_TOOL
   * - TERMINAL_PANEL, WEB_BROWSER_TOOL
   * - COMMIT_ATTRIBUTION, COWORKER_TYPE_TELEMETRY
   */
  export function feature(name: string): boolean;
}
