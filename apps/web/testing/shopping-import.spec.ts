import { expect, test } from "@playwright/test";
import {
  claimShoppingImport,
  clearShoppingImport,
  discardShoppingImport,
  inspectShoppingImport,
  importOwnerKey,
  shoppingStorageKey,
  withShoppingStorageLock,
} from "../src/lib/shopping-list/repository.ts";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const raw = JSON.stringify({
  version: 2,
  items: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      intent: "generic",
      canonicalId: null,
      label: "Huevos",
      query: "huevos",
      quantity: { amount: 1, unit: "unit" },
      frequency: "weekly",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
});

function browser(
  options: { getFails?: boolean; setFails?: boolean; removeFails?: boolean; locks?: boolean } = {},
) {
  const entries = new Map<string, string>([[shoppingStorageKey, raw]]);
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => {
          if (options.getFails) throw new Error("SecurityError");
          return entries.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (options.setFails) throw new Error("QuotaExceededError");
          entries.set(key, value);
        },
        removeItem: (key: string) => {
          if (options.removeFails) throw new Error("SecurityError");
          entries.delete(key);
        },
      },
      navigator: {
        locks:
          options.locks === false
            ? undefined
            : {
                request: async (
                  _name: string,
                  { signal }: { signal: AbortSignal },
                  action: () => Promise<unknown>,
                ) => {
                  const request = tail.then(() => {
                    signal.throwIfAborted();
                    return action();
                  });
                  tail = request.then(
                    () => {},
                    () => {},
                  );
                  return request;
                },
              },
      },
    },
  });
  return entries;
}

test.afterEach(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

test("import ownership and storage errors have distinct results", () => {
  const entries = browser();
  expect(claimShoppingImport("A")).toBe("claimed");
  expect(claimShoppingImport("B")).toBe("other-account");
  expect(entries.get(importOwnerKey)).toBe("A");
  browser({ getFails: true });
  expect(inspectShoppingImport().status).toBe("unavailable");
  expect(claimShoppingImport("A")).toBe("unavailable");
  browser({ setFails: true });
  expect(claimShoppingImport("A")).toBe("unavailable");
});

test("discard compares bytes and owner while storage failures retain the snapshot", () => {
  const entries = browser();
  claimShoppingImport("A");
  const inspection = inspectShoppingImport();
  if (inspection.status !== "available") throw new Error("Expected fixture snapshot");
  entries.set(shoppingStorageKey, raw + " ");
  expect(discardShoppingImport(inspection.snapshot)).toBe("changed");
  entries.set(shoppingStorageKey, raw);
  entries.set(importOwnerKey, "B");
  expect(discardShoppingImport(inspection.snapshot)).toBe("changed");
  entries.set(importOwnerKey, "A");
  expect(discardShoppingImport(inspection.snapshot)).toBe("discarded");
  expect(entries.has(shoppingStorageKey)).toBe(false);
  expect(entries.has(importOwnerKey)).toBe(false);
  const blocked = browser({ removeFails: true });
  expect(discardShoppingImport({ ...inspection.snapshot, owner: null })).toBe("unavailable");
  expect(blocked.get(shoppingStorageKey)).toBe(raw);
});

test("two coordinated accounts cannot both claim a pending snapshot", async () => {
  const entries = browser();
  const signal = new AbortController().signal;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let claimed!: () => void;
  const firstClaim = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const a = withShoppingStorageLock(async () => {
    const result = claimShoppingImport("A");
    claimed();
    await gate;
    return result;
  }, signal);
  await firstClaim;
  const b = withShoppingStorageLock(() => claimShoppingImport("B"), signal);
  release();
  expect(await Promise.all([a, b])).toEqual(["claimed", "other-account"]);
  expect(entries.get(shoppingStorageKey)).toBe(raw);
  expect(entries.get(importOwnerKey)).toBe("A");
});

test("queued discard cannot delete a write that committed while it waited", async () => {
  const entries = browser();
  claimShoppingImport("A");
  const inspection = inspectShoppingImport();
  if (inspection.status !== "available") throw new Error("Expected fixture snapshot");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  const started = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const writer = withShoppingStorageLock(async () => {
    acquired();
    await gate;
    entries.set(shoppingStorageKey, raw + " ");
  }, new AbortController().signal);
  await started;
  const discard = withShoppingStorageLock(
    () => discardShoppingImport(inspection.snapshot),
    new AbortController().signal,
  );
  release();
  await writer;
  expect(await discard).toBe("changed");
  expect(entries.get(shoppingStorageKey)).toBe(raw + " ");
});

test("missing coordination fails closed and an unconfirmed snapshot never clears", async () => {
  browser({ locks: false });
  await expect(
    withShoppingStorageLock(() => claimShoppingImport("A"), new AbortController().signal),
  ).rejects.toThrow();
  expect(
    await withShoppingStorageLock(
      () => inspectShoppingImport().status,
      new AbortController().signal,
      false,
    ),
  ).toBe("available");
  browser();
  const inspection = inspectShoppingImport();
  if (inspection.status !== "available") throw new Error("Expected fixture snapshot");
  expect(clearShoppingImport(inspection.snapshot.list, "A")).toBe("changed");
  expect(inspectShoppingImport().status).toBe("available");
});
