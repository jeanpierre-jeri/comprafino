import { expect, it } from "vitest";
import { DiagnosticError, safeDiagnostic } from "./diagnostics.ts";
it("allowlists reasons and SQLSTATE without copying arbitrary errors or sensitive causes", () => {
  const context = {
    stage: "persistence",
    operation: "discovery",
    retailer: "metro",
    reason: "db_write_failed",
  } as const;
  const error = new Error("postgres://secret@internal payload", {
    cause: { code: "23514", message: "query=personal name", stack: "secret", detail: "payload" },
  });
  const diagnostic = safeDiagnostic(error, context);
  expect(diagnostic).toEqual({
    ...context,
    message: "Database write failed.",
    databaseCode: "23514",
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(/secret|personal|payload/u);
  expect(safeDiagnostic({ code: "postgres://secret", name: "custom secret" }, context)).toEqual({
    ...context,
    message: "Database write failed.",
  });
  const wrapped = new DiagnosticError(error, context);
  expect(wrapped.cause).toBe(error);
  expect(safeDiagnostic(wrapped, { ...context, stage: "source" })).toEqual(diagnostic);
});
it("retains safe timeout and validation distinctions at the failing stage", () => {
  const context = {
    stage: "source",
    operation: "targeted",
    reason: "source_request_failed",
  } as const;
  expect(safeDiagnostic({ name: "TimeoutError", message: "secret" }, context).reason).toBe(
    "source_timeout",
  );
  expect(safeDiagnostic({ name: "ZodError", issues: ["raw source"] }, context).reason).toBe(
    "invalid_source_response",
  );
  expect(
    safeDiagnostic(
      { name: "SyntaxError" },
      { ...context, stage: "public", reason: "db_read_failed" },
    ).reason,
  ).toBe("validation_failed");
});

it("sync diagnostics do not copy documents or session material", () => {
  const diagnostic = safeDiagnostic(
    new Error("session_token=secret label=personal", {
      cause: { name: "ZodError", issues: ["private list"], token: "secret" },
    }),
    { stage: "persistence", operation: "list_sync", reason: "db_write_failed" },
  );
  expect(diagnostic).toEqual({
    stage: "persistence",
    operation: "list_sync",
    reason: "validation_failed",
    message: "Boundary validation failed.",
  });
});
