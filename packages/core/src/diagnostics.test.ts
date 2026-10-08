import { expect, it } from "vitest";
import { z } from "zod";
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

it("reports bounded schema-owned source paths without values, messages or dynamic keys", () => {
  const error = new z.ZodError([
    {
      code: "invalid_type",
      expected: "boolean",
      path: ["props", "pageProps", "productData", "variants", 0, "isPurchaseable"],
      message: "private payload",
    },
    { code: "custom", path: ["secret_customer_key"], message: "private payload" },
    { code: "custom", path: ["variants", 1000, "id"], message: "private payload" },
    ...Array.from({ length: 10 }, () => ({
      code: "custom" as const,
      path: ["prices"],
      message: "private payload",
    })),
  ]);
  const context = {
    stage: "source",
    operation: "targeted",
    reason: "source_request_failed",
  } as const;
  const diagnostic = safeDiagnostic(error, context);
  expect(diagnostic.validationType).toBe("schema");
  expect(diagnostic.validationIssues).toHaveLength(5);
  expect(diagnostic.validationIssues?.[0]).toEqual({
    code: "invalid_type",
    path: "props.pageProps.productData.variants.0.isPurchaseable",
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|secret|1000/u);
  expect(
    safeDiagnostic({ name: "ZodError", issues: error.issues }, context).validationIssues,
  ).toBeUndefined();
  expect(
    safeDiagnostic(error, { ...context, stage: "persistence" }).validationIssues,
  ).toBeUndefined();
  expect(safeDiagnostic(new SyntaxError("private payload"), context)).toMatchObject({
    reason: "invalid_source_response",
    validationType: "json_syntax",
  });
});
