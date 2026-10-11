import type { ReportProgress } from "../../../scripts/cli-progress.ts";

export type HealthReadStage = "counts" | "offers_page" | "operations";

const transportCodes = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);
const databaseCodes = new Set(["42P01", "42703", "42501", "28P01", "57014", "53300", "57P01"]);

/** Never emit driver messages, SQL, connection URLs or arbitrary error properties. */
export function healthErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) break;
    const value = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (
      typeof value.code === "string" &&
      (transportCodes.has(value.code) || databaseCodes.has(value.code))
    ) {
      return value.code;
    }
    if (value.name === "ZodError") return "validation_failed";
    current = value.cause;
  }
  return "unknown";
}

export class CatalogHealthReadError extends Error {
  readonly stage: HealthReadStage;
  readonly code: string;
  readonly attempts: number;

  constructor(stage: HealthReadStage, code: string, attempts: number) {
    super("Catalog health read unavailable");
    this.stage = stage;
    this.code = code;
    this.attempts = attempts;
  }
}

/** Only these read-only health queries may retry once after a transient transport failure. */
export async function readHealthStep<T>(
  stage: HealthReadStage,
  read: () => Promise<T>,
  progress?: ReportProgress,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1000)),
): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await read();
    } catch (error) {
      const code = healthErrorCode(error);
      if (attempt === 2 || !transportCodes.has(code)) {
        throw new CatalogHealthReadError(stage, code, attempt);
      }
      progress?.(
        `Salud: conexión interrumpida en ${stage}; reintentando una vez`,
        undefined,
        undefined,
        code,
      );
      await pause();
    }
  }
  throw new Error("Unreachable health retry state");
}
