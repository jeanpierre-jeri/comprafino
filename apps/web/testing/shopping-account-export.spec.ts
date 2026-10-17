import { test, expect } from "@playwright/test";
import { shoppingListItemSchema } from "@comprafino/core";
import { exportAccountList } from "../src/lib/shopping-list/account-export.ts";
import { createShoppingQueryClient } from "../src/lib/shopping-list/query-client.ts";
import { shoppingListExportHandler } from "../src/server/shopping-list-export-handler.ts";

const session = {
  status: "authenticated",
  userId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
} as const;
const identity = {
  user: { id: session.userId },
  session: { id: session.sessionId, token: "excluded-auth-field" },
};
const list = {
  version: 2,
  items: [
    shoppingListItemSchema.parse({
      id: "00000000-0000-4000-8000-000000000003",
      intent: "generic",
      canonicalId: null,
      query: "pan",
      label: "Pan",
      quantity: { amount: 2, unit: "unit" },
      frequency: "weekly",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    }),
  ],
};

function harness(replies: (() => Promise<Response>)[]) {
  const queryClient = createShoppingQueryClient();
  const controller = new AbortController();
  const downloads: string[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    let requestUrl: string;
    if (typeof url === "string") {
      requestUrl = url;
    } else if (url instanceof URL) {
      requestUrl = url.href;
    } else {
      requestUrl = url.url;
    }
    calls.push({ url: requestUrl, init });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected export request");
    return reply();
  };
  return {
    queryClient,
    controller,
    downloads,
    calls,
    run: (budgetMs?: number) =>
      exportAccountList({
        queryClient,
        session,
        signal: controller.signal,
        request,
        budgetMs,
        download: (document) => downloads.push(document),
      }),
  };
}
const json =
  (body: unknown, status = 200) =>
  async () =>
    Response.json(body, { status });

test("11A downloads the validated saved list, rechecks identity and retains no export cache", async () => {
  const h = harness([json(list), json(identity)]);
  expect(await h.run()).toBe("downloaded");
  expect(h.downloads.map((document) => JSON.parse(document))).toEqual([list]);
  expect(h.calls.map((call) => call.url)).toEqual([
    "/api/list/export",
    "/api/auth/get-session?disableCookieCache=true",
  ]);
  expect(h.calls[0]?.init).toMatchObject({
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-comprafino-export-session": session.sessionId },
  });
  expect(h.queryClient.getQueryCache().getAll()).toEqual([]);
});

test("11A reports empty without a download and requests fresh data again", async () => {
  const h = harness([json({ version: 2, items: [] }), json(identity), json(list), json(identity)]);
  expect(await h.run()).toBe("empty");
  expect(h.downloads).toEqual([]);
  expect(await h.run()).toBe("downloaded");
  expect(h.calls).toHaveLength(4);
});

test("11A rejects expired, changed, failed and malformed replies without downloading", async () => {
  const cases = [
    { replies: [json({}, 401)], code: "expired" },
    { replies: [json({}, 409)], code: "changed" },
    { replies: [json({}, 503)], code: "unavailable" },
    { replies: [async () => new Response("{truncated")], code: "unavailable" },
    { replies: [json({ ...list, token: "unexpected" })], code: "unavailable" },
    { replies: [json({ ...list, version: 3 })], code: "unavailable" },
    { replies: [json(list), json(null)], code: "expired" },
    { replies: [json(list), json({}, 401)], code: "expired" },
    { replies: [json(list), json({}, 503)], code: "unavailable" },
    { replies: [json(list), json({ user: null })], code: "unavailable" },
    {
      replies: [json(list), json({ ...identity, user: { id: "another-account" } })],
      code: "changed",
    },
    {
      replies: [json(list), json({ ...identity, session: { id: "another-session" } })],
      code: "changed",
    },
    {
      replies: [
        async () => {
          throw new TypeError("Network failed");
        },
      ],
      code: "unavailable",
    },
  ];
  for (const entry of cases) {
    const h = harness(entry.replies);
    await expect(h.run()).rejects.toMatchObject({ code: entry.code });
    expect(h.downloads).toEqual([]);
    expect(h.queryClient.getQueryCache().getAll()).toEqual([]);
  }
});

test("11A cancels logout/unmount and ignores delayed list or identity bodies", async () => {
  for (const stage of ["list", "identity"]) {
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const delayed = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const response = Response.json({});
    response.json = () => {
      entered();
      return delayed;
    };
    const replies = stage === "list" ? [async () => response] : [json(list), async () => response];
    const h = harness(replies);
    const result = h.run();
    const rejected = expect(result).rejects.toMatchObject({ code: "unavailable" });
    await waiting;
    h.controller.abort();
    release(stage === "list" ? list : identity);
    await rejected;
    expect(h.downloads).toEqual([]);
    expect(h.queryClient.getQueryCache().getAll()).toEqual([]);
  }
});

test("11A bounds a stalled response and recovers on the next attempt without retry", async () => {
  const h = harness([() => new Promise<Response>(() => {}), json(list), json(identity)]);
  await expect(h.run(5)).rejects.toMatchObject({ code: "unavailable" });
  expect(h.calls).toHaveLength(1);
  expect(h.downloads).toEqual([]);
  expect(await h.run()).toBe("downloaded");
});

test("11A server bounds session resolution before any list read", async () => {
  let reads = 0;
  const handler = shoppingListExportHandler({
    budgetMs: 5,
    session: () => new Promise(() => {}),
    read: async () => {
      reads++;
      throw new Error("Must not read");
    },
  });
  const response = await handler(new Request("http://localhost/api/list/export"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "list_unavailable" });
  expect(reads).toBe(0);
});
