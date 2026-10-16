// 03E: full-body p95 < 9.6 s and maximum < 10 s at 50k / concurrency four.
// These are per-operation budgets, not a throughput limit or a production SLA.
export const publicRequestPolicy = {
  operationMs: 15_000,
  transportMs: 12_000,
  statementMs: 10_000,
  bodyMs: 5_000,
  // Four 50k searches can leave >5 s of after-response contention in local HTTP tests.
  demandMs: 10_000,
  demandStatementMs: 8_000,
  browserMs: 20_000,
  evaluationRefreshMs: 60_000,
} as const;
