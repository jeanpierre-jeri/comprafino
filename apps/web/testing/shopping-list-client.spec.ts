import { expect, test } from "@playwright/test";
import { emptyShoppingList, shoppingListItemSchema } from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";
import { remoteShoppingQueryKey } from "../src/lib/shopping-list/query-client.ts";
import { ShoppingListSyncClient } from "../src/lib/shopping-list/sync-client.ts";

const item = (n: number) =>
  shoppingListItemSchema.parse({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    intent: "generic",
    canonicalId: null,
    label: `Necesidad ${n}`,
    query: `necesidad ${n}`,
    quantity: { amount: 1, unit: "unit" },
    frequency: "weekly",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  });

const state = (revision = 0, items: ShoppingList["items"] = []) => ({
  revision,
  list: { version: 2, items },
});

function harness(anonymous: ShoppingList = emptyShoppingList()) {
  let stored = anonymous;
  let claim: string | null = null;
  let clears = 0,
    broadcasts = 0,
    writes = 0;
  const calls: { url: string; init?: RequestInit }[] = [];
  const replies: (() => Promise<Response>)[] = [];
  const client = new ShoppingListSyncClient(
    {
      read: () => ({ list: stored, warning: "" }),
      write: (list) => {
        stored = list;
        writes++;

        return "";
      },
      claim: (owner) => {
        if (claim && claim !== owner) return false;

        claim = owner;

        return true;
      },
      clear: (list, owner) => {
        if (stored !== list || claim !== owner) return false;

        stored = emptyShoppingList();
        claim = null;
        clears++;

        return true;
      },
    },
    async (url, init) => {
      calls.push({
        url: requestUrl(url),
        init,
      });
      const reply = replies.shift();

      if (!reply) {
        throw new Error("Unexpected request");
      }

      return reply();
    },
    () => {
      broadcasts++;
    },
  );

  return {
    client,
    calls,
    replies,
    reply: (body: unknown, status = 200) =>
      replies.push(async () => Response.json(body, { status })),
    stored: () => stored,
    setStored: (list: ShoppingList) => {
      stored = list;
    },
    clears: () => clears,
    broadcasts: () => broadcasts,
    writes: () => writes,
  };
}

async function idle(h: ReturnType<typeof harness>) {
  await expect.poll(() => h.client.getSnapshot().busy).toBe(false);
}

test("first login persists each item before clearing anonymous data; never writes remote into anonymous", async () => {
  const h = harness({ version: 2, items: [item(1), item(2)] });
  h.reply(state());
  h.reply(state(1, [item(1)]));
  h.reply(state(2, [item(1), item(2)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.clears()).toBe(1);
  expect(h.writes()).toBe(0);
  expect(h.broadcasts()).toBe(2);
  expect(
    h.calls
      .slice(1)
      .map(
        (c) => JSON.parse(typeof c.init?.body === "string" ? c.init.body : "null").expectedRevision,
      ),
  ).toEqual([0, 1]);
});

test("partial transport failure retains all anonymous items and retries from authoritative state", async () => {
  const anonymous: ShoppingList = { version: 2, items: [item(1), item(2)] };
  const h = harness(anonymous);
  h.reply(state());
  h.reply(state(1, [item(1)]));
  h.reply({ error: "unavailable" }, 503);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.stored()).toEqual(anonymous);
  expect(h.clears()).toBe(0);
  expect(h.client.getSnapshot().list.items).toHaveLength(1);
  h.reply(state(1, [item(1)]));
  h.reply(state(2, [item(1), item(2)]));
  await h.client.importAnonymous();
  expect(h.clears()).toBe(1);
});

test("one conflict replay uses current revision; second conflict stops", async () => {
  const h = harness();
  h.reply(state());
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  h.reply({ error: "revision_conflict", current: state(2, [item(2)]) }, 409);
  h.reply({ error: "revision_conflict", current: state(3, [item(2), item(3)]) }, 409);
  await expect(
    h.client.change((list) => ({ ...list, items: [...list.items, item(1)] })),
  ).rejects.toThrow();
  expect(h.calls).toHaveLength(3);
  expect(
    JSON.parse(typeof h.calls[2]?.init?.body === "string" ? h.calls[2].init.body : "null")
      .expectedRevision,
  ).toBe(2);
  expect(h.client.getSnapshot().list.items).toEqual([item(2), item(3)]);
});

test("import replay respects a newer remote winner and clears only the confirmed snapshot", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.reply(state());
  const newer = { ...item(1), updatedAt: "2026-10-07T00:00:00.000Z" };
  h.reply({ error: "revision_conflict", current: state(1, [newer]) }, 409);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.calls).toHaveLength(2);
  expect(h.clears()).toBe(1);
});

test("logout and account/session changes ignore late GET and POST results", async () => {
  for (const next of [null, "B:s2", "A:s2"] as const) {
    const h = harness();
    h.reply(state(1, [item(1)]));
    h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
    await idle(h);
    let resolve!: (response: Response) => void;
    h.replies.push(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = h.client.change(() => emptyShoppingList());
    const rejected = expect(pending).rejects.toThrow();
    await expect.poll(() => Boolean(resolve)).toBe(true);

    if (next) {
      h.reply(state(1, [item(2)]));
    }

    h.client.setSession(
      next
        ? { status: "authenticated", userId: next.startsWith("A:") ? "A" : "B", sessionId: "s2" }
        : { status: "anonymous" },
    );
    resolve(Response.json(state(2)));
    await rejected;
    await idle(h);
    expect(h.client.getSnapshot().list.items).toEqual(next ? [item(2)] : []);
    expect(h.writes()).toBe(0);
  }

  const h = harness();
  let resolve!: (response: Response) => void;
  h.replies.push(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  h.client.setSession({ status: "anonymous" });
  resolve(Response.json(state(1, [item(1)])));
  await idle(h);
  expect(h.client.getSnapshot().list.items).toEqual([]);
});

test("pending import is not copied to another account and concurrent anonymous edits prevent clearing", async () => {
  const anonymous: ShoppingList = { version: 2, items: [item(1)] };
  const h = harness(anonymous);
  h.reply(state());
  h.reply({}, 503);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  h.reply(state());
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  await idle(h);
  expect(h.calls).toHaveLength(3);
  expect(h.stored()).toEqual(anonymous);
  h.reply(state(1, [item(1)]));
  h.setStored({ version: 2, items: [item(1), item(2)] });
  h.reply(state(2, [item(1), item(2)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s2" });
  await idle(h);
  expect(h.clears()).toBe(1);
  const j = harness(anonymous);
  j.reply(state());
  j.replies.push(async () => {
    j.setStored({ version: 2, items: [item(1), item(2)] });

    return Response.json(state(1, [item(1)]));
  });
  j.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(j);
  expect(j.clears()).toBe(0);
});

test("cross-tab signals refetch remote, anonymous storage events reread local state", async () => {
  const h = harness();
  h.client.setSession({ status: "anonymous" });
  await h.client.change(() => ({ version: 2, items: [item(1)] }));
  expect(h.writes()).toBe(1);
  h.setStored(emptyShoppingList());
  h.client.storageChanged();
  expect(h.client.getSnapshot().list.items).toEqual([]);
  h.reply(state(1, [item(2)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  h.reply(state(2, [item(3)]));
  h.client.storageChanged();
  await idle(h);
  expect(h.client.getSnapshot().list.items).toEqual([item(3)]);
  expect(h.writes()).toBe(1);
});

test("capacity rejection retains anonymous storage while importing updates and items that fit", async () => {
  const h = harness({ version: 2, items: [item(51)] });
  h.reply(
    state(
      1,
      Array.from({ length: 50 }, (_, n) => item(n + 1)),
    ),
  );
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.calls).toHaveLength(1);
  expect(h.clears()).toBe(0);
  expect(h.client.getSnapshot().warning).toContain("50");
});

test("corrupt responses and infrastructure failures never become authoritative empty; 401 hides expired account", async () => {
  for (const status of [200, 503, 401]) {
    const h = harness();
    h.reply(state(1, [item(1)]));
    h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
    await idle(h);
    h.reply({ revision: 0, list: { version: 3, items: [] } }, status);
    await h.client.importAnonymous();
    expect(h.client.getSnapshot().warning).not.toBe("");
    expect(h.client.getSnapshot().list.items).toEqual(status === 401 ? [] : [item(1)]);
    expect(h.clears()).toBe(0);

    if (status === 401) {
      await expect(h.client.change(() => emptyShoppingList())).rejects.toThrow();
    }
  }
});

test("a successful-looking save that did not persist its item cannot clear anonymous storage", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.reply(state());
  h.reply(state(1));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.clears()).toBe(0);
  expect(h.stored().items).toEqual([item(1)]);
  expect(h.client.getSnapshot().warning).not.toBe("");
});

test("a tab signal during two import conflicts causes only a read, never a new replay sequence", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.reply(state());
  h.replies.push(async () => {
    h.client.storageChanged();

    return Response.json(
      { error: "revision_conflict", current: state(1, [item(2)]) },
      { status: 409 },
    );
  });
  h.reply({ error: "revision_conflict", current: state(2, [item(2), item(3)]) }, 409);
  h.reply(state(2, [item(2), item(3)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.calls.filter((c) => c.init?.method === "POST")).toHaveLength(2);
  expect(h.clears()).toBe(0);
  expect(h.client.getSnapshot().warning).toContain("Tu lista cambió");
});

test("POST session expiry hides remote state while retaining anonymous import data", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.reply(state(1, [item(2)]));
  h.reply({ error: "unauthenticated" }, 401);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.client.getSnapshot().ready).toBe(false);
  expect(h.client.getSnapshot().list.items).toEqual([]);
  expect(h.stored().items).toEqual([item(1)]);
  expect(h.clears()).toBe(0);
  h.client.setSession({ status: "anonymous" });
  expect(h.client.getSnapshot().list.items).toEqual([item(1)]);
});

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;

  if (input instanceof URL) return input.href;

  return input.url;
}

test("Zustand store instances isolate account data and keep an empty hydration snapshot", async () => {
  const first = harness();
  const second = harness();
  first.reply(state(1, [item(1)]));
  first.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  second.client.setSession({ status: "anonymous" });
  await idle(first);

  expect(first.client.store).not.toBe(second.client.store);
  expect(first.client.getSnapshot().list.items).toEqual([item(1)]);
  expect(second.client.getSnapshot().list.items).toEqual([]);
  expect(first.client.store.getInitialState()).toMatchObject({
    anonymousList: { version: 2, items: [] },
    session: { status: "checking", accountKnown: false },
  });
  expect(second.calls).toHaveLength(0);
});

test("an unavailable known session hides account data without restoring anonymous storage", async () => {
  const h = harness();
  h.reply(state(1, [item(1)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);

  h.client.setSession({ status: "unavailable", accountKnown: true });
  expect(h.client.getSnapshot()).toMatchObject({ ready: false, list: { items: [] } });
  await expect(h.client.change(() => emptyShoppingList())).rejects.toMatchObject({ code: "busy" });
  expect(h.writes()).toBe(0);
  expect(h.stored().items).toEqual([]);
});

test("late JSON parsing from an earlier account cannot replace the current query snapshot", async () => {
  const h = harness();
  let resolveBody: ((body: unknown) => void) | undefined;
  const delayed = Response.json(state());
  delayed.json = () =>
    new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
  h.replies.push(async () => delayed);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await expect.poll(() => Boolean(resolveBody)).toBe(true);

  h.reply(state(1, [item(2)]));
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  resolveBody?.(state(1, [item(1)]));
  await idle(h);
  expect(h.client.getSnapshot().list.items).toEqual([item(2)]);
  expect(h.broadcasts()).toBe(0);
  expect(h.writes()).toBe(0);
});

test("disposing a pending import aborts its request without clearing data or signaling success", async () => {
  const h = harness();
  h.reply(state());
  const session = { status: "authenticated" as const, userId: "A", sessionId: "s1" };
  h.client.setSession(session);
  await idle(h);

  h.setStored({ version: 2, items: [item(1)] });
  h.reply(state());
  let resolveSave: ((response: Response) => void) | undefined;
  h.replies.push(
    () =>
      new Promise<Response>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const pending = h.client.importAnonymous();
  await expect.poll(() => Boolean(resolveSave)).toBe(true);

  h.client.dispose();
  expect(h.calls[2]?.init?.signal?.aborted).toBe(true);
  resolveSave?.(Response.json(state(1, [item(1)])));
  await pending;
  expect(h.clears()).toBe(0);
  expect(h.broadcasts()).toBe(0);
  expect(h.stored().items).toEqual([item(1)]);
  expect(h.client.store.getState()).toMatchObject({
    ready: false,
    busy: false,
    anonymousList: { items: [] },
  });

  // If the server committed before teardown, a fresh read can safely finish the import.
  h.reply(state(1, [item(1)]));
  h.client.setSession(session);
  await idle(h);
  expect(h.clears()).toBe(1);
});

test("remote query data is session-scoped and never stored in Zustand", async () => {
  const h = harness();
  h.reply(state(1, [item(1)]));
  const session = { status: "authenticated" as const, userId: "A", sessionId: "s1" };
  h.client.setSession(session);
  await idle(h);

  expect(h.client.store.getState().anonymousList.items).toEqual([]);
  expect(h.client.queryClient.getQueryData(remoteShoppingQueryKey(session))).toMatchObject({
    list: { items: [item(1)] },
  });
  h.reply(state(1, [item(2)]));
  h.client.setSession({ ...session, userId: "B", sessionId: "s2" });
  await idle(h);
  expect(h.client.queryClient.getQueryData(remoteShoppingQueryKey(session))).toBeUndefined();
  expect(h.client.getSnapshot().list.items).toEqual([item(2)]);
});

test("logout before Query starts a mutation cannot send an old-account write", async () => {
  const h = harness();
  h.reply(state(1, [item(1)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);

  const pending = h.client.change(() => emptyShoppingList());
  const rejected = expect(pending).rejects.toMatchObject({ code: "accountChanged" });
  h.client.setSession({ status: "anonymous" });
  await rejected;
  expect(h.calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  expect(h.stored().items).toEqual([]);
});
