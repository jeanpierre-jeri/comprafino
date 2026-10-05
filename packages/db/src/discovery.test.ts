import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "./client.ts";
import { recordDiscoveryForSearch, discoveryOutcomeSchema } from "./discovery.ts";

describe("public discovery boundary", () => {
  it("existing results and invalid queries never touch the database", async () => {
    const db = createDatabase({ DATABASE_URL: "postgresql://unused@localhost/unused" });
    const batch = vi.spyOn(db, "batch");
    expect(await recordDiscoveryForSearch(db, "arroz", 1)).toBe(false);
    expect(await recordDiscoveryForSearch(db, "??", 0)).toBe(false);
    expect(batch).not.toHaveBeenCalled();
  });
  it("accepts only safe error summaries and bounded outcomes", () => {
    expect(
      discoveryOutcomeSchema.safeParse({
        status: "failed",
        resultCount: 0,
        error: "postgresql://secret",
      }).success,
    ).toBe(false);
    expect(
      discoveryOutcomeSchema.safeParse({ status: "completed", resultCount: 31, error: null })
        .success,
    ).toBe(false);
  });
});
