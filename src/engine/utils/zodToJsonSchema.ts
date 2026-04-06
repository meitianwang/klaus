/**
 * Converts Zod v4 schemas to JSON Schema using native toJSONSchema.
 */

import { toJSONSchema, type ZodTypeAny } from 'zod/v4'

export type JsonSchema7Type = Record<string, unknown>

// toolToAPISchema() runs this for every tool on every API request (~60-250
// times/turn). Tool schemas are wrapped with lazySchema() which guarantees the
// same ZodTypeAny reference per session, so we can cache by identity.
const cache = new WeakMap<ZodTypeAny, JsonSchema7Type>()

/**
 * Converts a Zod v4 schema to JSON Schema format.
 * Falls back to manual conversion for zod v3 schemas.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema7Type {
  const hit = cache.get(schema)
  if (hit) return hit
  let result: JsonSchema7Type
  try {
    result = toJSONSchema(schema) as JsonSchema7Type
  } catch {
    // Fallback for zod v3 schemas: use .shape if available
    const s = schema as any
    if (s?._def?.typeName === 'ZodObject' && s.shape) {
      const props: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, val] of Object.entries(s.shape)) {
        const v = val as any
        if (v?._def?.typeName === 'ZodString') props[key] = { type: 'string' }
        else if (v?._def?.typeName === 'ZodNumber') props[key] = { type: 'number' }
        else if (v?._def?.typeName === 'ZodBoolean') props[key] = { type: 'boolean' }
        else props[key] = {}
        if (!v?.isOptional?.()) required.push(key)
      }
      result = { type: 'object', properties: props, ...(required.length ? { required } : {}) }
    } else {
      // Empty object schema as last resort
      result = { type: 'object', properties: {} }
    }
  }
  cache.set(schema, result)
  return result
}
