import { retailerIdSchema, safeIngestionError } from "@comprafino/core";
import type { RetailerId } from "@comprafino/core";

export interface RefreshTasks {
  ingest(retailer: RetailerId): Promise<{ fetched: number; persisted: number; changed: number }>;
  targeted?(): Promise<{ observed: number; failures: number; requests: number; changed: number }>;
  normalize(): Promise<{ processed: number; changed: number }>;
  match(): Promise<{ candidates: number; associationsChanged: number; productsChanged: number }>;
}
type Outcome<T> =
  | { status: "success"; result: T }
  | { status: "failed"; error: string }
  | { status: "skipped" };
export interface RefreshEvent {
  stage: RetailerId | "targeted" | "normalization" | "matching" | "overall";
  status: "started" | "success" | "failed" | "skipped";
  at: string;
}
export async function refreshCatalog(
  tasks: RefreshTasks,
  dryRun = false,
  log: (event: RefreshEvent) => void = () => {},
) {
  const startedAt = Date.now();
  const event = (stage: RefreshEvent["stage"], status: RefreshEvent["status"]) =>
    log({ stage, status, at: new Date().toISOString() });
  const retailers: {
    retailer: RetailerId;
    outcome: Outcome<Awaited<ReturnType<RefreshTasks["ingest"]>>>;
  }[] = [];
  for (const retailer of retailerIdSchema.options) {
    event(retailer, "started");
    try {
      const result = await tasks.ingest(retailer);
      retailers.push({ retailer, outcome: { status: "success", result } });
      event(retailer, "success");
    } catch {
      retailers.push({ retailer, outcome: { status: "failed", error: safeIngestionError } });
      event(retailer, "failed");
    }
  }
  let targeted: Outcome<{ observed: number; failures: number; requests: number; changed: number }> =
    { status: "skipped" };
  if (!dryRun && tasks.targeted) {
    event("targeted", "started");
    try {
      targeted = { status: "success", result: await tasks.targeted() };
    } catch {
      targeted = {
        status: "failed",
        error: "Targeted refresh failed; inspect listing attempt metadata.",
      };
    }
    event(
      "targeted",
      targeted.status === "success" && targeted.result.failures > 0 ? "failed" : targeted.status,
    );
  }
  let normalization: Outcome<Awaited<ReturnType<RefreshTasks["normalize"]>>> = {
    status: "skipped",
  };
  let matching: Outcome<Awaited<ReturnType<RefreshTasks["match"]>>> = { status: "skipped" };
  if (
    !dryRun &&
    (retailers.some((r) => r.outcome.status === "success") ||
      (targeted.status === "success" && targeted.result.observed > 0) ||
      targeted.status === "failed")
  ) {
    event("normalization", "started");
    try {
      normalization = { status: "success", result: await tasks.normalize() };
    } catch {
      normalization = {
        status: "failed",
        error: "Normalization failed; check database, migrations and scope.",
      };
    }
    if (normalization.status === "success") {
      event("normalization", "success");
      event("matching", "started");
      try {
        matching = { status: "success", result: await tasks.match() };
      } catch {
        matching = {
          status: "failed",
          error: "Matching failed; check fresh normalization and complete scope.",
        };
      }
    } else event("normalization", "failed");
  }
  if (normalization.status === "skipped") event("normalization", "skipped");
  event("matching", matching.status);
  const status =
    retailers.every((r) => r.outcome.status === "success") &&
    targeted.status !== "failed" &&
    !(targeted.status === "success" && targeted.result.failures > 0) &&
    normalization.status !== "failed" &&
    matching.status !== "failed"
      ? "success"
      : "failed";
  event("overall", status);
  return {
    dryRun,
    retailers,
    targeted,
    normalization,
    matching,
    status,
    durationMs: Date.now() - startedAt,
  };
}
export function parseRefreshOptions(args: readonly string[]) {
  const options = args.filter((arg) => arg !== "--");
  if (options.length > 1 || options.some((arg) => arg !== "--dry-run"))
    throw new Error("Use pnpm refresh:catalog -- --dry-run (optional)");
  return { dryRun: options.includes("--dry-run") };
}
