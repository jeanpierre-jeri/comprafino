import { expect, test } from "@playwright/test";
import { emptyShoppingList, shoppingListItemSchema } from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";
import { remoteShoppingQueryKey } from "../src/lib/shopping-list/query-client.ts";
import { ShoppingStorageCoordinationError } from "../src/lib/shopping-list/repository.ts";
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

function harness(anonymous: ShoppingList = emptyShoppingList(), budgetMs?: number) {
  let stored = anonymous;
  let blocked = false,
    claimBlocked = false,
    clearBlocked = false,
    coordination = true;
  let lockWait: Promise<void> | null = null;
  let claim: string | null = null;
  let clears = 0,
    broadcasts = 0,
    writes = 0;
  const calls: { url: string; init?: RequestInit }[] = [];
  const replies: (() => Promise<Response>)[] = [];
  const client = new ShoppingListSyncClient(
    {
      read: () => ({ list: stored, warning: blocked ? "Storage blocked" : "" }),
      write: (list) => {
        stored = list;
        writes++;

        return "";
      },
      claim: (owner) => {
        if (claimBlocked) return "unavailable";
        if (claim && claim !== owner) return "other-account";

        claim = owner;

        return "claimed";
      },
      clear: (list, owner) => {
        if (clearBlocked) return "unavailable";
        if (stored !== list || claim !== owner) return "changed";

        stored = emptyShoppingList();
        claim = null;
        clears++;

        return "cleared";
      },
      inspect: () => {
        if (blocked) return { status: "unavailable" };
        if (!stored.items.length) return { status: "empty" };
        return {
          status: "available",
          snapshot: { list: stored, raw: JSON.stringify(stored), owner: claim },
        };
      },
      discard: (snapshot) => {
        if (blocked) return "unavailable";
        if (snapshot.raw !== JSON.stringify(stored) || snapshot.owner !== claim) return "changed";
        stored = emptyShoppingList();
        claim = null;
        clears++;
        return "discarded";
      },
      exclusive: async (action, signal, required = true) => {
        if (!coordination && required) {
          throw new ShoppingStorageCoordinationError();
        }
        if (lockWait) await lockWait;
        signal.throwIfAborted();
        return action();
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
    budgetMs,
  );

  return {
    client,
    calls,
    replies,
    reply: (body: unknown, status = 200) =>
      replies.push(async () => Response.json(body, { status })),
    stored: () => stored,
    setBlocked: (next: boolean) => {
      blocked = next;
    },
    setClaimBlocked: (next: boolean) => {
      claimBlocked = next;
    },
    setClearBlocked: (next: boolean) => {
      clearBlocked = next;
    },
    setClaim: (next: string) => {
      claim = next;
    },
    owner: () => claim,
    setCoordination: (next: boolean) => {
      coordination = next;
    },
    setLockWait: (next: Promise<void>) => {
      lockWait = next;
    },
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
  expect(h.client.getSnapshot().ready).toBe(false);
  expect(
    h.client.queryClient.getQueryData(remoteShoppingQueryKey(h.client.getSnapshot().session)),
  ).toEqual(state(1, [item(1)]));
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
  await expect.poll(() => Boolean(resolve)).toBe(true);
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
  expect(h.client.getSnapshot().warning).toBe(
    "La copia de este navegador está pendiente de importación en otra cuenta. Tu lista actual no se modificó.",
  );
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
  expect(h.client.getSnapshot().importIssue).toBe("rejected");
});

test("identity rejection retains the copy without claiming that the account is full", async () => {
  const original = item(1);
  const duplicate = item(2);
  const collision = { ...original, query: duplicate.query, label: duplicate.label };
  const h = harness({ version: 2, items: [collision] });
  h.reply(state(1, [{ ...original, updatedAt: "2026-10-05T00:00:00.000Z" }, duplicate]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.calls).toHaveLength(1);
  expect(h.clears()).toBe(0);
  expect(h.stored().items).toEqual([collision]);
  expect(h.client.getSnapshot().warning).toContain("necesidades repetidas");
  expect(h.client.getSnapshot().importIssue).toBe("rejected");
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

test("a timed-out committed mutation is never replayed and requires a read before editing", async () => {
  const h = harness(emptyShoppingList(), 25);
  h.reply(state(1, [item(1)]));
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  let release: ((response: Response) => void) | undefined;
  h.replies.push(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  await expect(h.client.change(() => emptyShoppingList())).rejects.toMatchObject({
    code: "uncertain",
  });
  expect(h.calls).toHaveLength(2);
  expect(h.calls[1]?.init?.signal?.aborted).toBe(true);
  expect(h.client.getSnapshot().ready).toBe(false);
  expect(
    h.client.queryClient.getQueryData(remoteShoppingQueryKey(h.client.getSnapshot().session)),
  ).toEqual(state(1, [item(1)]));
  await expect(h.client.change(() => emptyShoppingList())).rejects.toMatchObject({ code: "busy" });
  release?.(Response.json(state(2)));
  // The write committed but its late response cannot repopulate authoritative state.
  h.reply(state(2));
  await h.client.refreshRemote();
  expect(h.calls).toHaveLength(3);
  expect(h.calls[2]?.init?.method).toBeUndefined();
  expect(h.client.getSnapshot()).toMatchObject({
    ready: true,
    warning: "",
    list: emptyShoppingList(),
  });
  expect(h.broadcasts()).toBe(0);
  h.client.dispose();
});

test("slow list reads release busy state and allow later recovery without clearing saved data", async () => {
  const h = harness(emptyShoppingList(), 25);
  let release: ((response: Response) => void) | undefined;
  h.replies.push(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.client.getSnapshot().ready).toBe(false);
  expect(h.client.getSnapshot().warning).not.toBe("");
  expect(h.calls).toHaveLength(1);
  release?.(Response.json(state(1, [item(1)])));
  h.reply(state(2, [item(2)]));
  await h.client.importAnonymous();
  expect(h.client.getSnapshot().list.items).toEqual([item(2)]);
  expect(h.calls).toHaveLength(2);
  expect(h.writes()).toBe(0);
  h.client.dispose();
});

test("recovery exports only the retained local snapshot and discards it without touching another account", async () => {
  const anonymous: ShoppingList = { version: 2, items: [item(1), item(2)] };
  const h = harness(anonymous);
  h.reply(state());
  h.reply(state(1, [item(1)]));
  h.reply({}, 503);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  h.reply(state(9, [item(9)]));
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  await idle(h);
  expect(h.client.getSnapshot().importIssue).toBe("other-account");
  const recovery = h.client.prepareImportRecovery();
  const callsBeforeRecovery = h.calls.length;
  expect(JSON.parse(await h.client.exportPendingImport(recovery))).toEqual(anonymous);
  expect(h.owner()).toBe("A");
  expect(h.clears()).toBe(0);
  await h.client.discardPendingImport(recovery);
  expect(h.stored().items).toEqual([]);
  expect(h.owner()).toBeNull();
  expect(h.client.getSnapshot().list).toEqual(state(9, [item(9)]).list);
  expect(h.calls).toHaveLength(callsBeforeRecovery);
  expect(h.writes()).toBe(0);
  expect(h.client.getSnapshot().importIssue).toBeNull();
});

test("changed snapshot or owner invalidates export and confirmed discard without removing data", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.setClaim("A");
  h.reply(state(1, [item(9)]));
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  await idle(h);
  const stale = h.client.prepareImportRecovery();
  h.setStored({ version: 2, items: [item(1), item(2)] });
  await expect(h.client.exportPendingImport(stale)).rejects.toThrow("cambió");
  await expect(h.client.discardPendingImport(stale)).rejects.toThrow("cambió");
  const updated = h.client.prepareImportRecovery();
  h.setClaim("C");
  await expect(h.client.discardPendingImport(updated)).rejects.toThrow("cambió");
  expect(h.stored().items).toHaveLength(2);
  expect(h.owner()).toBe("C");
  expect(h.clears()).toBe(0);
});

test("logout aborts a queued discard and late recovery tokens cannot affect a new session", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.setClaim("A");
  h.reply(state());
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  await idle(h);
  const recovery = h.client.prepareImportRecovery();
  let release!: () => void;
  h.setLockWait(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const discarded = expect(h.client.discardPendingImport(recovery)).rejects.toThrow();
  h.client.setSession({ status: "anonymous" });
  release();
  await discarded;
  await expect(h.client.exportPendingImport(recovery)).rejects.toThrow("cuenta cambió");
  expect(h.stored().items).toHaveLength(1);
  expect(h.owner()).toBe("A");
  expect(h.clears()).toBe(0);
});

test("storage access, claim quota and clear failure are distinct from another account and recover safely", async () => {
  for (const phase of ["read", "claim", "clear"] as const) {
    const h = harness({ version: 2, items: [item(1)] });
    h.reply(state());
    if (phase === "read") h.setBlocked(true);
    if (phase === "claim") h.setClaimBlocked(true);
    if (phase === "clear") {
      h.setClearBlocked(true);
      h.reply(state(1, [item(1)]));
    }
    h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
    await idle(h);
    expect(h.client.getSnapshot().importIssue).toBe("storage");
    expect(h.client.getSnapshot().warning).not.toContain("otra cuenta");
    expect(h.clears()).toBe(0);
    expect(h.stored().items).toHaveLength(1);
    h.setBlocked(false);
    h.setClaimBlocked(false);
    h.setClearBlocked(false);
    h.reply(phase === "clear" ? state(1, [item(1)]) : state());
    if (phase !== "clear") h.reply(state(1, [item(1)]));
    await h.client.importAnonymous();
    expect(h.clears()).toBe(1);
  }
});

test("missing coordination blocks import and discard but permits a local backup and anonymous edits", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.setCoordination(false);
  h.reply(state());
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.client.getSnapshot().importIssue).toBe("coordination");
  const recovery = h.client.prepareImportRecovery();
  expect(JSON.parse(await h.client.exportPendingImport(recovery)).items).toHaveLength(1);
  await expect(h.client.discardPendingImport(recovery)).rejects.toThrow("coordinar");
  expect(h.clears()).toBe(0);
  expect(h.calls).toHaveLength(1);
  h.client.setSession({ status: "anonymous" });
  await h.client.change((list) => ({ ...list, items: [...list.items, item(2)] }));
  expect(h.stored().items).toHaveLength(2);
});

test("a recovery handler from a different rendered session cannot switch the coordinator or start an import", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.setClaim("A");
  h.reply(state(1, [item(9)]));
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  await idle(h);
  const recovery = h.client.prepareImportRecovery();
  const otherSession = { status: "authenticated", userId: "A", sessionId: "s1" } as const;
  expect(() => h.client.prepareImportRecovery(otherSession)).toThrow("cuenta cambió");
  expect(() => h.client.assertImportRecovery(recovery, otherSession)).toThrow("cuenta cambió");
  expect(h.client.getSnapshot().session).toEqual({
    status: "authenticated",
    userId: "B",
    sessionId: "s2",
  });
  expect(h.calls).toHaveLength(1);
  expect(h.owner()).toBe("A");
});

test("logout after snapshot serialization prevents a late export result without clearing the copy", async () => {
  const h = harness({ version: 2, items: [item(1)] });
  h.setClaim("A");
  h.reply(state(1, [item(9)]));
  h.client.setSession({ status: "authenticated", userId: "B", sessionId: "s2" });
  await idle(h);
  const recovery = h.client.prepareImportRecovery();
  const exported = expect(h.client.exportPendingImport(recovery)).rejects.toThrow("cuenta cambió");
  h.client.setSession({ status: "anonymous" });
  await exported;
  expect(h.stored().items).toHaveLength(1);
  expect(h.owner()).toBe("A");
  expect(h.clears()).toBe(0);
  expect(h.calls).toHaveLength(1);
});

test("an uncertain partial import permits a local backup but blocks discard until a successful read", async () => {
  const local: ShoppingList = { version: 2, items: [item(1), item(2)] };
  const h = harness(local);
  h.reply(state());
  h.reply(state(1, [item(1)]));
  h.reply({}, 503);
  h.client.setSession({ status: "authenticated", userId: "A", sessionId: "s1" });
  await idle(h);
  expect(h.client.getSnapshot().ready).toBe(false);
  const recovery = h.client.prepareImportRecovery();
  expect(JSON.parse(await h.client.exportPendingImport(recovery))).toEqual(local);
  await expect(h.client.discardPendingImport(recovery)).rejects.toThrow("confirmar si el cambio");
  expect(h.clears()).toBe(0);
  expect(h.calls).toHaveLength(3);
  h.reply(state(1, [item(1)]));
  await h.client.refreshRemote();
  await h.client.discardPendingImport(recovery);
  expect(h.clears()).toBe(1);
  expect(h.calls).toHaveLength(4);
  expect(h.client.getSnapshot().list.items).toEqual([item(1)]);
});
