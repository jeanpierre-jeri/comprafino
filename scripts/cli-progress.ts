export type ReportProgress = (
  phase: string,
  completed?: number,
  total?: number,
  detail?: string,
) => void;

/** Human progress belongs on stderr; stdout remains the machine-readable report. */
export function createCliProgress(): ReportProgress {
  const enabled =
    process.env.NODE_ENV !== "production" &&
    !process.env.CI &&
    !process.env.GITHUB_ACTIONS &&
    process.env.COMPRAFINO_PROGRESS !== "0" &&
    (process.stderr.isTTY || process.env.COMPRAFINO_PROGRESS === "1");
  const startedAt = Date.now();
  let previousPhase = "";
  let previousAt = 0;

  return (phase, completed, total, detail) => {
    if (!enabled) return;
    const now = Date.now();
    const finished = total !== undefined && completed === total;
    if (phase === previousPhase && !finished && now - previousAt < 2000) return;
    previousPhase = phase;
    previousAt = now;
    let count = "";
    if (completed !== undefined) {
      count = ` | ${completed}`;
      if (total !== undefined) {
        const percent = total > 0 ? Math.floor((completed / total) * 100) : 100;
        count += `/${total} (${percent}%)`;
      }
    }
    const elapsed = Math.floor((now - startedAt) / 1000);
    process.stderr.write(
      `[progreso ${elapsed}s] ${phase}${count}${detail ? ` | ${detail}` : ""}\n`,
    );
  };
}
