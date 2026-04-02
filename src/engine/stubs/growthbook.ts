/**
 * GrowthBook stubs — no-op replacements for claude-code's feature flag system.
 * All functions return default/falsy values.
 */

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  _key: string,
  defaultValue: T,
): T {
  return defaultValue
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  _gate: string,
): boolean {
  return false
}
