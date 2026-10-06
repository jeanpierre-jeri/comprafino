import { randomUUID } from "node:crypto";
import { z } from "zod";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { shoppingListItemSchema, shoppingListRevisionMaximum } from "@comprafino/core";
import { ownedTestDatabase } from "./testing/database.ts";
import { closeLocalTestConnections } from "./testing/test-query-client.ts";
import * as schema from "./schema.ts";
import {
  readUserShoppingList,
  mutateUserShoppingList,
  ShoppingListDomainError,
  ShoppingListRevisionExhaustedError,
} from "./user-shopping-lists.ts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("remote shopping persistence (explicit owned TEST_DATABASE_URL)", () => {
  const harness = ownedTestDatabase({
    ...process.env,
    TEST_DATABASE_URL: url ?? "postgresql://unused@localhost/comprafino_test",
  });
  const { db, scoped } = harness;
  let userId = randomUUID();
  const item = (n = 0) =>
    shoppingListItemSchema.parse({
      id: randomUUID(),
      intent: "generic",
      canonicalId: null,
      label: `Necesidad ${n}`,
      query: `necesidad ${n}`,
      quantity: { amount: 1, unit: "unit" },
      frequency: "weekly",
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });
  const save = (expectedRevision: number, value = item()) =>
    mutateUserShoppingList(db, userId, {
      expectedRevision,
      operation: { type: "save", item: value },
    });
  const remove = (expectedRevision: number, id: string) =>
    mutateUserShoppingList(db, userId, { expectedRevision, operation: { type: "remove", id } });
  beforeAll(() => harness.setup(), 30_000);
  beforeEach(async () => {
    await scoped.query('truncate "user" cascade');
    userId = randomUUID();
    await db
      .insert(schema.user)
      .values({ id: userId, name: "Test Owner", email: `${userId}@example.com` });
  });
  afterAll(async () => {
    try {
      await harness.dispose();
    } finally {
      await closeLocalTestConnections();
    }
  });
  it("database rejects stored revision zero", async () => {
    await expect(
      db
        .insert(schema.userShoppingLists)
        .values({ userId, revision: 0, data: { version: 2, items: [] } }),
    ).rejects.toThrow(/Failed query/u);
    expect(await readUserShoppingList(db, userId)).toEqual({
      revision: 0,
      list: { version: 2, items: [] },
    });
  });
  it("absence and revision-zero missing removal never insert or write", async () => {
    const query = vi.spyOn(scoped, "query");
    expect(await readUserShoppingList(db, userId)).toEqual({
      revision: 0,
      list: { version: 2, items: [] },
    });
    expect(await remove(0, randomUUID())).toEqual({
      status: "success",
      state: { revision: 0, list: { version: 2, items: [] } },
    });
    expect(query).toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => sql.startsWith("select"))).toBe(true);
    query.mockRestore();
    expect(await db.select().from(schema.userShoppingLists)).toEqual([]);
  });
  it("save advances revisions, deduplicates through core and preserves ID/createdAt", async () => {
    const first = item();
    expect(await save(0, first)).toMatchObject({ status: "success", state: { revision: 1 } });
    const replacement = {
      ...first,
      id: randomUUID(),
      createdAt: "2026-10-07T00:00:00.000Z",
      quantity: { amount: 2, unit: "unit" as const },
    };
    expect(await save(1, replacement)).toMatchObject({
      status: "success",
      state: {
        revision: 2,
        list: { items: [{ id: first.id, createdAt: first.createdAt, quantity: { amount: 2 } }] },
      },
    });
    expect((await readUserShoppingList(db, userId)).list.items).toHaveLength(1);
  });
  it("remove increments and leaves a persisted empty row; absent removal is read-only", async () => {
    const first = item();
    await save(0, first);
    const before = await db.select().from(schema.userShoppingLists);
    const query = vi.spyOn(scoped, "query");
    expect(await remove(1, randomUUID())).toMatchObject({
      status: "success",
      state: { revision: 1 },
    });
    expect(query).toHaveBeenCalled();
    expect(query.mock.calls.every(([sql]) => sql.startsWith("select"))).toBe(true);
    query.mockRestore();
    expect(await db.select().from(schema.userShoppingLists)).toEqual(before);
    expect(await remove(1, first.id)).toEqual({
      status: "success",
      state: { revision: 2, list: { version: 2, items: [] } },
    });
    const after = await db.select().from(schema.userShoppingLists);
    expect(after).toHaveLength(1);
    expect(after[0]?.createdAt).toEqual(before[0]?.createdAt);
  });
  it("stale/future revisions conflict before mutation, including missing removals", async () => {
    const first = item();
    await save(0, first);
    const current = await readUserShoppingList(db, userId);
    const before = await db.select().from(schema.userShoppingLists);

    for (const expected of [0, 2, 99]) {
      expect(await save(expected)).toEqual({ status: "conflict", current });
      expect(await remove(expected, randomUUID())).toEqual({ status: "conflict", current });
    }

    expect(await db.select().from(schema.userShoppingLists)).toEqual(before);
  });
  it("positive revision against absence conflicts without insertion", async () => {
    for (const result of [await save(5), await remove(5, randomUUID())]) {
      expect(result).toEqual({
        status: "conflict",
        current: { revision: 0, list: { version: 2, items: [] } },
      });
    }

    expect(await db.select().from(schema.userShoppingLists)).toEqual([]);
  });

  function barrierDatabase(kind: "insert" | "select") {
    let arrivals = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new Proxy(scoped, {
      get(target, property, receiver) {
        if (property !== "query") return Reflect.get(target, property, receiver);

        return async (...args: Parameters<typeof scoped.query>) => {
          const intercepted = args[0].startsWith(kind) && args[0].includes('"user_shopping_lists"');

          if (kind === "select") {
            const rows = await target.query(...args);

            if (intercepted && arrivals < 2) {
              arrivals++;

              if (arrivals === 2) {
                release();
              }

              await gate;
            }

            return rows;
          }

          if (intercepted && arrivals < 2) {
            arrivals++;

            if (arrivals === 2) {
              release();
            }

            await gate;
          }

          return target.query(...args);
        };
      },
    });

    return drizzle(client, { schema });
  }

  for (const revision of [0, 5]) {
    it(`concurrent revision ${revision} writers have one winner and a fresh loser state`, async () => {
      if (revision) {
        await save(0);
        await db
          .update(schema.userShoppingLists)
          .set({ revision })
          .where(eq(schema.userShoppingLists.userId, userId));
      }

      // Only test transport is intercepted: inserts meet before execution, positive readers both see revision 5.
      const concurrent = barrierDatabase(revision ? "select" : "insert");
      const results = await Promise.all(
        [1, 2].map((n) =>
          mutateUserShoppingList(concurrent, userId, {
            expectedRevision: revision,
            operation: { type: "save", item: item(n) },
          }),
        ),
      );
      const winners = results.filter((r) => r.status === "success");
      const losers = results.filter((r) => r.status === "conflict");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(winners[0]?.state.revision).toBe(revision + 1);
      expect(losers[0]?.current).toEqual(winners[0]?.state);
      expect(await readUserShoppingList(db, userId)).toEqual(winners[0]?.state);
    });
  }

  it("user FK rejects orphan lists and cascades directly on user deletion", async () => {
    await expect(
      mutateUserShoppingList(db, randomUUID(), {
        expectedRevision: 0,
        operation: { type: "save", item: item() },
      }),
    ).rejects.toThrow(/Failed query/u);
    await save(0);
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    expect(await db.select().from(schema.userShoppingLists)).toEqual([]);
  });
  it("corrupt and unsupported JSONB are not erased, including insert conflicts", async () => {
    await save(0);
    const value = item();

    for (const data of [
      null,
      { version: 3, items: [] },
      { version: 2, items: [{}] },
      "invalid",
      { version: 2, items: [], extra: true },
      { version: 2, items: [{ ...value, extra: true }] },
      { version: 2, items: [{ ...value, quantity: { ...value.quantity, extra: true } }] },
    ]) {
      // JSON null is not SQL NULL and deliberately exercises the read boundary.
      await scoped.query("update user_shopping_lists set data = $1::jsonb", [JSON.stringify(data)]);
      const before = await db.select().from(schema.userShoppingLists);
      await expect(readUserShoppingList(db, userId)).rejects.toBeInstanceOf(z.ZodError);
      await expect(save(1)).rejects.toBeInstanceOf(z.ZodError);
      await expect(save(0)).rejects.toBeInstanceOf(z.ZodError);
      expect(await db.select().from(schema.userShoppingLists)).toEqual(before);
    }
  });
  it("51st distinct need rejects, while edits/deduplication at 50 remain valid", async () => {
    const items = Array.from({ length: 50 }, (_, n) => item(n));
    await db
      .insert(schema.userShoppingLists)
      .values({ userId, revision: 1, data: { version: 2, items } });
    await expect(save(1, item(51))).rejects.toBeInstanceOf(ShoppingListDomainError);
    expect((await readUserShoppingList(db, userId)).revision).toBe(1);
    const first = items[0];

    if (!first) {
      throw new Error("Missing item");
    }

    expect(await save(1, { ...first, id: randomUUID() })).toMatchObject({
      status: "success",
      state: { revision: 2 },
    });
    expect((await readUserShoppingList(db, userId)).list.items).toHaveLength(50);
    expect(await save(2, { ...first, quantity: { amount: 2, unit: "unit" } })).toMatchObject({
      status: "success",
      state: { revision: 3 },
    });
  });
  it("revision ceiling refuses changing saves/removes but permits missing removal without writes", async () => {
    const first = item();
    await save(0, first);
    await db
      .update(schema.userShoppingLists)
      .set({ revision: shoppingListRevisionMaximum })
      .where(eq(schema.userShoppingLists.userId, userId));
    const before = await db.select().from(schema.userShoppingLists);
    await expect(save(shoppingListRevisionMaximum)).rejects.toBeInstanceOf(
      ShoppingListRevisionExhaustedError,
    );
    await expect(remove(shoppingListRevisionMaximum, first.id)).rejects.toBeInstanceOf(
      ShoppingListRevisionExhaustedError,
    );
    expect(await remove(shoppingListRevisionMaximum, randomUUID())).toMatchObject({
      status: "success",
      state: { revision: shoppingListRevisionMaximum },
    });
    expect(await db.select().from(schema.userShoppingLists)).toEqual(before);
  });
});
