/** Remove duplicates while preserving insertion order; never mutates the input. */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export * from "./listing.ts";
