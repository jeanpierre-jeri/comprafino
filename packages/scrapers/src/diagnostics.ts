import { safeDiagnostic } from "@comprafino/core";
import type { DiagnosticContext } from "@comprafino/core";

export function reportCatalogAlert(severity: "error" | "warning", detail: string) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::${severity}::${detail}`);
  } else {
    console.error(`Catalog ${severity}: ${detail}`);
  }
}

export function logDiagnostic(error: unknown, context: DiagnosticContext) {
  console.error("CompraFino operation failed", safeDiagnostic(error, context));
}
