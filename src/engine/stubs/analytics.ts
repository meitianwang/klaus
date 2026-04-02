/**
 * Analytics stubs — no-op replacements for claude-code's analytics/telemetry.
 * All functions are no-ops since Klaus doesn't use Statsig/GrowthBook.
 */

// biome-ignore lint: stub
export function logEvent(..._args: any[]): void {}

// biome-ignore lint: stub
export function sanitizeToolNameForAnalytics(name: string): string {
  return name
}

// biome-ignore lint: stub
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = Record<string, unknown>
