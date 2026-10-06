import { safeDiagnostic } from "@comprafino/core";
import type { DiagnosticContext } from "@comprafino/core";

export function logDiagnostic(error: unknown, context: DiagnosticContext) {
  console.error("CompraFino operation failed", safeDiagnostic(error, context));
}
