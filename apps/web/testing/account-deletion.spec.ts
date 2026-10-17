import { expect, test } from "@playwright/test";
import { deleteOwnAccount } from "../src/lib/account-deletion.ts";
import { createShoppingQueryClient } from "../src/lib/shopping-list/query-client.ts";
import { authHandlers } from "../src/server/auth-handler.ts";

const session = { status: "authenticated", userId: "A", sessionId: "s1" } as const;
const success = { success: true, message: "User deleted" };

test("11B sends one session-bound confirmed request and accepts only native deletion success", async () => {
  const queryClient = createShoppingQueryClient();
  const calls: RequestInit[] = [];
  await deleteOwnAccount({
    queryClient,
    session,
    signal: new AbortController().signal,
    request: async (url, init) => {
      expect(url).toBe("/api/auth/delete-user");
      calls.push(init!);
      return Response.json(success);
    },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    body: "{}",
    headers: {
      "x-comprafino-delete-owner": "A",
      "x-comprafino-delete-session": "s1",
      "x-comprafino-confirm-delete": "delete-own-account",
    },
  });
  queryClient.clear();
});

test("11B distinguishes rejection and reauthentication from an uncertain write without retry", async () => {
  const cases = [
    { status: 401, body: {}, code: "expired" },
    { status: 409, body: {}, code: "changed" },
    { status: 400, body: { code: "SESSION_EXPIRED" }, code: "reauthenticate" },
    { status: 403, body: {}, code: "rejected" },
    { status: 429, body: {}, code: "rejected" },
    { status: 503, body: {}, code: "uncertain" },
    { status: 200, body: { success: true, message: "Verification email sent" }, code: "uncertain" },
    { status: 200, body: { success: false }, code: "uncertain" },
  ];
  for (const entry of cases) {
    let calls = 0;
    const queryClient = createShoppingQueryClient();
    await expect(
      deleteOwnAccount({
        queryClient,
        session,
        signal: new AbortController().signal,
        request: async () => {
          calls++;
          return Response.json(entry.body, { status: entry.status });
        },
      }),
    ).rejects.toMatchObject({ code: entry.code });
    expect(calls).toBe(1);
    queryClient.clear();
  }
});

test("11B a lost, malformed or stalled reply never confirms or automatically repeats deletion", async () => {
  for (const failure of ["network", "json", "timeout"]) {
    const queryClient = createShoppingQueryClient();
    let calls = 0;
    await expect(
      deleteOwnAccount({
        queryClient,
        session,
        signal: new AbortController().signal,
        budgetMs: 5,
        request: async () => {
          calls++;
          if (failure === "network") throw new TypeError("Lost reply after possible commit");
          if (failure === "json") return new Response("{truncated");
          return new Promise<Response>(() => {});
        },
      }),
    ).rejects.toMatchObject({ code: "uncertain" });
    expect(calls).toBe(1);
    queryClient.clear();
  }
});

test("11B cancellation before sending differs from cancellation after dispatch", async () => {
  for (const before of [true, false]) {
    const queryClient = createShoppingQueryClient();
    const controller = new AbortController();
    let calls = 0;
    if (before) controller.abort();
    await expect(
      deleteOwnAccount({
        queryClient,
        session,
        signal: controller.signal,
        request: async () => {
          calls++;
          controller.abort();
          return Response.json(success);
        },
      }),
    ).rejects.toMatchObject({ code: before ? "cancelled" : "uncertain" });
    expect(calls).toBe(before ? 0 : 1);
    queryClient.clear();
  }
});

test("11B native success arriving after the deadline remains uncertain and cannot clear a new cookie", async () => {
  let release!: () => void;
  const late = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = authHandlers(
    () => ({
      handler: async () => {
        await late;
        return Response.json(success, {
          headers: { "set-cookie": "new-cookie=must-not-be-forwarded" },
        });
      },
    }),
    5,
  );
  const response = await handler.POST(
    new Request("http://localhost/api/auth/delete-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "DELETE_UNCERTAIN" });
  expect(response.headers.get("set-cookie")).toBeNull();
  release();
});
