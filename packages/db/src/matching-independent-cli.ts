import { evaluateIndependentAudit } from "./matching-independent.ts";
try {
  const { version, canonicalGroupsReviewed, metrics } = await evaluateIndependentAudit();
  console.log(JSON.stringify({ version, canonicalGroupsReviewed, metrics }, null, 2));
} catch {
  console.error(
    "Independent matching audit failed. Check fixture, DATABASE_URL and pg_trgm migration.",
  );
  process.exitCode = 1;
}
