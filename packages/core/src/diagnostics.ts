import type { RetailerId } from "./listing.ts";

const messages = {
  source_timeout: "Retailer request timed out.",
  source_request_failed: "Retailer request failed.",
  invalid_source_response: "Retailer response was invalid.",
  db_write_failed: "Database write failed.",
  db_read_failed: "Database read failed.",
  validation_failed: "Boundary validation failed.",
  listing_not_found: "Listing was not found.",
  availability_ambiguous: "Listing availability was ambiguous.",
} as const;
export type DiagnosticReason = keyof typeof messages;
export interface DiagnosticContext {
  stage:
    | "source"
    | "persistence"
    | "normalization"
    | "matching"
    | "public"
    | "admission"
    | "completion";
  operation:
    | "ingestion"
    | "refresh"
    | "discovery"
    | "targeted"
    | "comparison"
    | "listing"
    | "history"
    | "search"
    | "evaluation"
    | "product_search";
  reason: DiagnosticReason;
  retailer?: RetailerId;
}
export interface SafeDiagnostic extends DiagnosticContext {
  message: string;
  databaseCode?: string;
}

/** Allowlisted context and SQLSTATE only. Never copy message, stack, URL or payload. */
export function safeDiagnostic(error: unknown, context: DiagnosticContext): SafeDiagnostic {
  if (error instanceof DiagnosticError) return error.diagnostic;
  let reason = context.reason;
  let databaseCode: string | undefined;
  let current = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    if ("name" in current) {
      if (
        context.stage === "source" &&
        (current.name === "TimeoutError" || current.name === "AbortError")
      )
        reason = "source_timeout";
      if (current.name === "ZodError" || current.name === "SyntaxError")
        reason = context.stage === "source" ? "invalid_source_response" : "validation_failed";
    }
    if (
      "code" in current &&
      typeof current.code === "string" &&
      [
        "23503",
        "23505",
        "23514",
        "40001",
        "40P01",
        "42P01",
        "42703",
        "53300",
        "57014",
        "08006",
      ].includes(current.code)
    )
      databaseCode = current.code;
    current = "cause" in current ? current.cause : null;
  }
  return {
    ...context,
    reason,
    message: messages[reason],
    ...(databaseCode ? { databaseCode } : {}),
  };
}
export class DiagnosticError extends Error {
  readonly diagnostic: SafeDiagnostic;
  constructor(error: unknown, context: DiagnosticContext) {
    const diagnostic = safeDiagnostic(error, context);
    super(diagnostic.message, { cause: error });
    this.diagnostic = diagnostic;
  }
}
