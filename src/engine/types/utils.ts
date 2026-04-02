/**
 * Utility types — reconstructed from claude-code's build-time generated types.
 */

/**
 * Recursively makes all properties readonly and all arrays readonly.
 */
export type DeepImmutable<T> = T extends (infer U)[]
  ? readonly DeepImmutable<U>[]
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
    : T extends Set<infer U>
      ? ReadonlySet<DeepImmutable<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
        : T
