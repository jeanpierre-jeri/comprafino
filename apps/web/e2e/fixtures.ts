import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export type { Locator, Page } from "@playwright/test";

let clientSequence = 0;

export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders, baseURL }, use, testInfo) => {
    if (!baseURL || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) {
      throw new Error("Isolated E2E client addresses require the local test server");
    }

    // Next forwards this header to the real auth handler. Give each test (and
    // retry) its own documentation-only IPv6 /64: Better Auth groups IPv6 by
    // subnet, so changing only the host bits would still share the rate limit.
    // workerIndex is unique across worker restarts; the sequence is worker-local.
    clientSequence += 1;
    const address = `2001:db8:${testInfo.workerIndex.toString(16)}:${clientSequence.toString(16)}::1`;
    await use({ ...extraHTTPHeaders, "x-forwarded-for": address });
  },
});
