/**
 * Utility types — reconstructed from claude-code's build-time generated types.
 */

/**
 * Recursively makes all properties readonly and all arrays readonly.
 */
export type DeepImmutable<T> = T extends (infer U)[]
  ? readonly DeepImmutable<U>[]
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
    : T extends ReadonlySet<infer U>
      ? ReadonlySet<DeepImmutable<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
        : T

/**
 * Given a union type T, produces a tuple type that contains every member of the union.
 * Used with `satisfies` to ensure exhaustive coverage of union members.
 */
export type Permutations<T, U = T> = [T] extends [never]
  ? []
  : T extends T
    ? [T, ...Permutations<Exclude<U, T>>]
    : never
