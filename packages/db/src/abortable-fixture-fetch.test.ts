import { describe, expect, it } from "vitest";
import { abortableFixtureFetch } from "./testing/abortable-fixture-fetch.ts";

describe("owned HTTP fixture cancellation", () => {
  it("returns successful values and preserves failures", async () => {
    await expect(abortableFixtureFetch(Promise.resolve(42))).resolves.toBe(42);
    const error = new Error("database failure");
    await expect(abortableFixtureFetch(Promise.reject(error))).rejects.toBe(error);
  });

  it("reports a timeout while allowing the owned SQL to settle before teardown", async () => {
    const controller = new AbortController();
    let finish!: (value: number) => void;
    const transport = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const result = abortableFixtureFetch(transport, controller.signal);
    const timeout = new DOMException("deadline", "TimeoutError");
    controller.abort(timeout);
    await expect(result).rejects.toBe(timeout);
    finish(42);
    await expect(transport).resolves.toBe(42);
  });

  it("handles already-aborted signals and a later transport rejection", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      abortableFixtureFetch(Promise.reject(new Error("late SQL error")), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
