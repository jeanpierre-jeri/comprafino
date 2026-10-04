export const discoveryDailyLimit = 30;
export const discoveryRetailerLimit = 10;
export const discoveryCooldownHours = 24;

/** Only formatting changes; quantities, punctuation and accents retain identity. */
export function normalizeDiscoveryQuery(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}
export function validDiscoveryQuery(value: string): boolean {
  // Bound work before Unicode normalization; do not retain pathological input.
  if (value.length > 240 || /\s{33}|[\p{Cc}\p{Cf}]/u.test(value)) return false;
  const query = normalizeDiscoveryQuery(value);
  return (
    query.length >= 3 &&
    query.length <= 80 &&
    /\p{L}/u.test(query) &&
    (query.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3
  );
}
export function discoveryQueryForSearch(value: string, resultCount: number): string | null {
  return resultCount === 0 && validDiscoveryQuery(value) ? normalizeDiscoveryQuery(value) : null;
}
export function parseDiscoveryOptions(args: readonly string[]) {
  let limit = 10;
  let dryRun = false;
  const seen = new Set<string>();
  for (const arg of args.filter((value) => value !== "--")) {
    const key = arg.split("=")[0]!;
    if (seen.has(key)) throw new Error("Duplicate discovery option");
    seen.add(key);
    if (arg === "--dry-run") dryRun = true;
    else if (/^--limit=\d+$/u.test(arg)) limit = Number(arg.slice(8));
    else throw new Error("Use --dry-run and --limit=1..30");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > discoveryDailyLimit)
    throw new Error("Discovery limit must be 1..30");
  return { limit, dryRun };
}
