import { expect, it, vi } from "vitest";
import { CatalogHealthReadError, healthErrorCode, readHealthStep } from "./catalog-health-read.ts";

it("retries one interrupted read without exposing private driver details", async () => {
  const error = new Error("private database URL and SQL", {
    cause: Object.assign(new Error("private payload"), { code: "UND_ERR_SOCKET" }),
  });
  const read = vi
    .fn<() => Promise<number>>()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce(42);
  const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const progress = vi.fn<() => void>();
  expect(await readHealthStep("offers_page", read, progress, pause)).toBe(42);
  expect(read).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledOnce();
  expect(JSON.stringify(progress.mock.calls)).toContain("UND_ERR_SOCKET");
  expect(JSON.stringify(progress.mock.calls)).not.toContain("private");
});

it("stops after the second transport failure with a safe stage diagnostic", async () => {
  const read = vi.fn<() => Promise<never>>().mockRejectedValue({ code: "ECONNRESET" });
  const pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  await expect(readHealthStep("operations", read, undefined, pause)).rejects.toMatchObject({
    stage: "operations",
    code: "ECONNRESET",
    attempts: 2,
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledOnce();
});

it.each(["42P01", "42703", "42501", "28P01", "57014", "private-code"])(
  "does not retry SQL, permission or unrecognized failures: %s",
  async (code) => {
    const read = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue({ code, message: "private query" });
    const pause = vi.fn<() => Promise<void>>();
    await expect(readHealthStep("counts", read, undefined, pause)).rejects.toBeInstanceOf(
      CatalogHealthReadError,
    );
    expect(read).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
  },
);

it("refuses arbitrary codes and bounds traversal of cyclic error causes", () => {
  const error: { code: string; cause?: unknown } = { code: "credential-value" };
  error.cause = error;
  expect(healthErrorCode(error)).toBe("unknown");
});
