import { MutationObserver } from "@tanstack/react-query";
import { createShoppingQueryClient, remoteShoppingQueryKey } from "./query-client";
import { createStore } from "zustand/vanilla";
import {
  emptyShoppingList,
  saveShoppingItem,
  removeShoppingItem,
  remoteShoppingListStateSchema,
  shoppingListRevisionConflictSchema,
  shoppingImportOperation,
  shoppingListSyncOperationSchema,
} from "@comprafino/core";
import type {
  ShoppingList,
  RemoteShoppingListState,
  ShoppingListSyncOperation,
} from "@comprafino/core";
import { serializeShoppingList } from "@comprafino/core";
import { ShoppingStorageCoordinationError } from "./repository";
import type { ShoppingImportInspection, ShoppingImportSnapshot } from "./repository";
import { sameShoppingSession } from "./session";
import type { ShoppingSession } from "./session";
import { ShoppingListSyncError, shoppingSyncFailure } from "./sync-errors";
import { withinRequestBudget } from "../request-budget";
import { publicRequestPolicy } from "../public-request-policy";

export type ShoppingImportIssue =
  | "other-account"
  | "storage"
  | "rejected"
  | "snapshot-changed"
  | "coordination"
  | "interrupted";

export type ShoppingImportRecovery = { snapshot: ShoppingImportSnapshot; generation: number };

export type ShoppingListClientState = {
  anonymousList: ShoppingList;
  importIssue: ShoppingImportIssue | null;
  warning: string;
  ready: boolean;
  busy: boolean;
  session: ShoppingSession;
};

type ShoppingStorage = {
  read: (fallback: ShoppingList) => { list: ShoppingList; warning: string };
  write: (list: ShoppingList) => string;
  claim: (owner: string) => "claimed" | "other-account" | "unavailable";
  clear: (list: ShoppingList, owner: string) => "cleared" | "changed" | "unavailable";
  inspect: () => ShoppingImportInspection;
  discard: (snapshot: ShoppingImportSnapshot) => "discarded" | "changed" | "unavailable";
  exclusive: <T>(
    action: () => Promise<T> | T,
    signal: AbortSignal,
    required?: boolean,
  ) => Promise<T>;
};

type RefreshMode = "read-only" | "import-anonymous";

const pendingImportMessage =
  "La copia de este navegador está pendiente de importación en otra cuenta. Tu lista actual no se modificó.";

const incompleteImportMessage =
  "No pudimos importar todas las necesidades. Revisa el límite de 50 y posibles necesidades repetidas. Conservamos la copia local completa; resuelve el bloqueo y reintenta.";

function initialSnapshot(): ShoppingListClientState {
  return {
    anonymousList: emptyShoppingList(),
    importIssue: null,
    warning: "",
    ready: false,
    busy: false,
    session: { status: "checking", accountKnown: false },
  };
}

function operationForChange(
  previous: ShoppingList,
  changed: ShoppingList,
): ShoppingListSyncOperation {
  const removed = previous.items.filter(
    (item) => !changed.items.some((next) => next.id === item.id),
  );
  const saved = changed.items.filter((item) => {
    const existing = previous.items.find((current) => current.id === item.id);

    return JSON.stringify(item) !== JSON.stringify(existing);
  });

  if (removed.length + saved.length !== 1) {
    throw new ShoppingListSyncError("invalidMutation");
  }

  if (saved[0]) return { type: "save", item: saved[0] };

  return { type: "remove", id: removed[0]!.id };
}

export class ShoppingListSyncClient {
  readonly store = createStore<ShoppingListClientState>(() => initialSnapshot());

  readonly queryClient = createShoppingQueryClient();
  private anonymous = emptyShoppingList();
  private generation = 0;
  private controller = new AbortController();
  private refreshAgain = false;
  private expired = false;
  private uncertain = false;

  constructor(
    private storage: ShoppingStorage,
    private request: typeof fetch,
    private broadcast: () => void,
    private budgetMs: number = publicRequestPolicy.browserMs,
  ) {}

  getSnapshot = () => {
    const snapshot = this.store.getState();
    let list = emptyShoppingList();
    if (snapshot.session.status === "anonymous") {
      list = snapshot.anonymousList;
    } else if (snapshot.ready) {
      list = this.remote?.list ?? list;
    }
    return { ...snapshot, list };
  };

  private get remote() {
    const session = this.store.getState().session;
    if (session.status !== "authenticated" || this.expired) return undefined;
    return this.queryClient.getQueryData<RemoteShoppingListState>(remoteShoppingQueryKey(session));
  }

  private clearServerState() {
    // Cancellation precedes removal; late transport/body results still check generation.
    void this.queryClient.cancelQueries();
    this.queryClient.clear();
  }

  private update(patch: Partial<ShoppingListClientState>) {
    this.store.setState(patch);
  }

  dispose() {
    this.controller.abort();
    this.generation++;
    this.clearServerState();
    this.refreshAgain = false;
    this.uncertain = false;
    this.update(initialSnapshot());
  }

  setSession(session: ShoppingSession) {
    if (sameShoppingSession(session, this.getSnapshot().session)) return;

    this.controller.abort();
    this.controller = new AbortController();
    this.generation++;
    this.clearServerState();
    this.expired = false;
    this.uncertain = false;
    this.refreshAgain = false;
    this.update({ session, warning: "", importIssue: null, ready: false, busy: false });

    if (session.status === "anonymous") {
      this.readAnonymous();
    } else if (session.status === "authenticated") {
      void this.importAnonymous();
    }
  }

  private readAnonymous() {
    const stored = this.storage.read(this.anonymous);
    this.anonymous = stored.list;
    this.update({ anonymousList: stored.list, warning: stored.warning, ready: true });
  }

  storageChanged() {
    const session = this.getSnapshot().session;

    if (session.status === "anonymous") {
      this.readAnonymous();
    } else if (session.status === "authenticated") {
      void this.refreshRemote();
    }
  }

  private active(generation: number) {
    return generation === this.generation;
  }

  private assertActive(generation: number, signal?: AbortSignal) {
    if (!this.active(generation)) {
      throw new ShoppingListSyncError("accountChanged");
    }

    signal?.throwIfAborted();
  }

  private async parseResponse(response: Response): Promise<RemoteShoppingListState> {
    if (response.status === 401) {
      this.expired = true;
      this.clearServerState();
      const failure = new ShoppingListSyncError("expired");
      this.update({ ready: false, warning: failure.message });

      throw failure;
    }

    if (!response.ok) {
      throw new ShoppingListSyncError("unavailable");
    }

    return remoteShoppingListStateSchema.parse(await response.json());
  }

  private applyRemote(state: RemoteShoppingListState) {
    const session = this.store.getState().session;
    this.queryClient.setQueryData(remoteShoppingQueryKey(session), state);
  }

  private async mutate(
    operation: ShoppingListSyncOperation,
    generation: number,
    signal: AbortSignal,
  ) {
    let pending = shoppingListSyncOperationSchema.parse(operation);

    // One initial attempt and one replay; every await is guarded by session generation.
    for (let attempt = 0; attempt < 2; attempt++) {
      this.assertActive(generation, signal);

      if (!this.remote) {
        throw new ShoppingListSyncError("unavailable");
      }

      const expected =
        pending.type === "save"
          ? saveShoppingItem(this.remote.list, pending.item)
          : removeShoppingItem(this.remote.list, pending.id);
      const changesRevision =
        pending.type === "save" || expected.items.length !== this.remote.list.items.length;
      const expectedRevision = this.remote.revision + Number(changesRevision);
      const response = await this.request("/api/list/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: this.remote.revision, operation: pending }),
        signal,
      });
      this.assertActive(generation, signal);

      if (response.status === 409) {
        const conflict = shoppingListRevisionConflictSchema.parse(await response.json());
        this.assertActive(generation, signal);
        this.applyRemote(conflict.current);

        if (attempt === 1) {
          throw new ShoppingListSyncError("conflict");
        }

        if (pending.type === "save") {
          const replayOperation = shoppingImportOperation(conflict.current.list, pending.item);

          if (!replayOperation) return;

          pending = replayOperation;
        }

        continue;
      }

      if ([400, 403, 413, 415, 422].includes(response.status)) {
        throw new ShoppingListSyncError("invalidMutation");
      }

      const state = await this.parseResponse(response);
      this.assertActive(generation, signal);

      if (
        state.revision !== expectedRevision ||
        JSON.stringify(state.list) !== JSON.stringify(expected)
      ) {
        throw new ShoppingListSyncError("unavailable");
      }

      this.applyRemote(state);
      this.assertActive(generation);
      this.broadcast();

      return;
    }
  }

  private async readRemote(generation: number) {
    const session = this.store.getState().session;
    await this.queryClient.fetchQuery({
      queryKey: remoteShoppingQueryKey(session),
      queryFn: ({ signal }) =>
        withinRequestBudget(this.budgetMs, signal, async (requestSignal) => {
          this.assertActive(generation);
          const response = await this.request("/api/list/sync", {
            cache: "no-store",
            credentials: "same-origin",
            signal: requestSignal,
          });
          this.assertActive(generation, requestSignal);

          const state = await this.parseResponse(response);
          this.assertActive(generation, requestSignal);
          return state;
        }),
    });
    this.assertActive(generation);
    this.update({ ready: true });
  }

  private async executeMutation(operation: ShoppingListSyncOperation, generation: number) {
    const mutation = new MutationObserver(this.queryClient, {
      mutationKey: [
        "shopping-list-mutation",
        ...remoteShoppingQueryKey(this.store.getState().session),
      ],
      mutationFn: (input: { operation: ShoppingListSyncOperation; generation: number }) =>
        withinRequestBudget(this.budgetMs, this.controller.signal, (signal) =>
          this.mutate(input.operation, input.generation, signal),
        ),
      retry: false,
      networkMode: "always",
      gcTime: 0,
    });
    try {
      await mutation.mutate({ operation, generation });
    } catch (error) {
      this.assertActive(generation);

      if (error instanceof ShoppingListSyncError && error.code !== "unavailable") throw error;

      // Preserve Query's last document and anonymous storage, but withhold quotes
      // and further mutations until a successful GET establishes the saved state.
      this.uncertain = true;
      this.update({ ready: false });
      throw new ShoppingListSyncError("uncertain", { cause: error });
    } finally {
      mutation.reset();
    }
  }

  private async persistAnonymous(owner: string, generation: number) {
    this.assertActive(generation);
    const stored = this.storage.read(this.anonymous);
    this.anonymous = stored.list;

    if (stored.warning) {
      this.update({ warning: stored.warning, importIssue: "storage" });

      return;
    }

    if (!stored.list.items.length) {
      this.update({ importIssue: null });
      return;
    }

    const claim = this.storage.claim(owner);
    if (claim !== "claimed") {
      this.update({
        warning:
          claim === "other-account"
            ? pendingImportMessage
            : new ShoppingListSyncError("importStorage").message,
        importIssue: claim === "other-account" ? "other-account" : "storage",
      });

      return;
    }

    let incomplete = false;

    for (const item of stored.list.items) {
      this.assertActive(generation);

      if (!this.remote) return;

      let operation;

      try {
        operation = shoppingImportOperation(this.remote.list, item);
      } catch {
        incomplete = true;
        continue;
      }

      if (operation) {
        await this.executeMutation(operation, generation);
      }
    }

    this.assertActive(generation);

    if (incomplete) {
      this.update({ warning: incompleteImportMessage, importIssue: "rejected" });
      return;
    }

    const cleared = this.storage.clear(stored.list, owner);
    if (cleared !== "cleared") {
      this.update({
        warning: new ShoppingListSyncError(
          cleared === "changed" ? "importChanged" : "importStorage",
        ).message,
        importIssue: cleared === "changed" ? "snapshot-changed" : "storage",
      });
      return;
    }

    this.anonymous = emptyShoppingList();
    this.update({ importIssue: null });
  }

  private finishSequence(generation: number) {
    if (!this.active(generation)) return;

    this.update({ busy: false });

    if (this.refreshAgain && !this.expired) {
      this.refreshAgain = false;
      void this.refreshRemote();
    }
  }

  refreshRemote = () => this.refresh("read-only");

  importAnonymous = () => this.refresh("import-anonymous");

  private async refresh(mode: RefreshMode) {
    const snapshot = this.getSnapshot();

    if (snapshot.session.status !== "authenticated" || this.expired) return;

    if (snapshot.busy) {
      this.refreshAgain = true;

      return;
    }

    const owner = snapshot.session.userId;
    const generation = this.generation;
    const reconcileOnly = this.uncertain;
    const warning = mode === "import-anonymous" ? "" : snapshot.warning;
    this.update({ busy: true, warning });

    try {
      await this.readRemote(generation);

      if (reconcileOnly) {
        this.uncertain = false;
        this.update({ warning: "" });
      }

      if (
        mode === "read-only" &&
        this.store.getState().importIssue &&
        this.storage.inspect().status === "empty"
      ) {
        this.update({ importIssue: null, warning: "" });
      }

      if (mode === "import-anonymous") {
        const inspection = this.storage.inspect();
        if (inspection.status === "available") {
          this.anonymous = inspection.snapshot.list;
          await this.storage.exclusive(
            () => this.persistAnonymous(owner, generation),
            this.controller.signal,
          );
        } else if (inspection.status === "empty") {
          this.update({ importIssue: null });
        } else {
          this.update({
            importIssue: "storage",
            warning: new ShoppingListSyncError("importStorage").message,
          });
        }
      }
    } catch (error) {
      if (this.active(generation)) {
        if (error instanceof ShoppingStorageCoordinationError) {
          this.update({
            warning: new ShoppingListSyncError("importCoordination").message,
            importIssue: "coordination",
          });
        } else {
          this.update({
            warning: shoppingSyncFailure(error, this.expired).message,
            importIssue:
              mode === "import-anonymous" && this.anonymous.items.length
                ? "interrupted"
                : this.store.getState().importIssue,
          });
        }
      }
    } finally {
      this.finishSequence(generation);
    }
  }

  prepareImportRecovery(expectedSession?: ShoppingSession): ShoppingImportRecovery {
    const current = this.getSnapshot();
    if (expectedSession && !sameShoppingSession(current.session, expectedSession)) {
      throw new ShoppingListSyncError("accountChanged");
    }
    if (current.session.status !== "authenticated") {
      throw new ShoppingListSyncError("expired");
    }
    if (current.busy) {
      throw new ShoppingListSyncError("busy");
    }

    const inspection = this.storage.inspect();
    if (inspection.status === "unavailable" || inspection.status === "invalid") {
      throw new ShoppingListSyncError("importStorage");
    }
    if (inspection.status !== "available") {
      throw new ShoppingListSyncError("importChanged");
    }

    return { snapshot: inspection.snapshot, generation: this.generation };
  }

  assertImportRecovery(recovery: ShoppingImportRecovery, expectedSession?: ShoppingSession) {
    this.assertActive(recovery.generation, this.controller.signal);
    const current = this.getSnapshot();
    if (expectedSession && !sameShoppingSession(current.session, expectedSession)) {
      throw new ShoppingListSyncError("accountChanged");
    }
    if (current.session.status !== "authenticated") {
      throw new ShoppingListSyncError("expired");
    }
    if (current.busy) {
      throw new ShoppingListSyncError("busy");
    }
  }

  async exportPendingImport(recovery: ShoppingImportRecovery) {
    this.assertImportRecovery(recovery);
    const signal = this.controller.signal;
    const serialized = await this.storage.exclusive(
      () => {
        this.assertActive(recovery.generation, signal);
        const inspection = this.storage.inspect();
        if (inspection.status === "unavailable" || inspection.status === "invalid") {
          throw new ShoppingListSyncError("importStorage");
        }
        if (
          inspection.status !== "available" ||
          inspection.snapshot.raw !== recovery.snapshot.raw ||
          inspection.snapshot.owner !== recovery.snapshot.owner
        ) {
          throw new ShoppingListSyncError("importChanged");
        }
        return serializeShoppingList(inspection.snapshot.list);
      },
      signal,
      false,
    );
    this.assertActive(recovery.generation, signal);
    return serialized;
  }

  async discardPendingImport(recovery: ShoppingImportRecovery) {
    this.assertImportRecovery(recovery);
    if (!this.getSnapshot().ready || this.expired) {
      throw new ShoppingListSyncError("uncertain");
    }
    const signal = this.controller.signal;
    this.update({ busy: true });
    try {
      await this.storage.exclusive(() => {
        this.assertActive(recovery.generation, signal);
        const result = this.storage.discard(recovery.snapshot);
        if (result !== "discarded") {
          throw new ShoppingListSyncError(result === "changed" ? "importChanged" : "importStorage");
        }
        this.anonymous = emptyShoppingList();
        this.update({ importIssue: null, warning: "" });
        this.broadcast();
      }, signal);
    } catch (error) {
      if (error instanceof ShoppingStorageCoordinationError) {
        throw new ShoppingListSyncError("importCoordination");
      }
      throw error;
    } finally {
      this.finishSequence(recovery.generation);
    }
  }

  async change(next: (current: ShoppingList) => ShoppingList) {
    const snapshot = this.getSnapshot();

    if (!snapshot.ready || snapshot.busy) {
      throw new ShoppingListSyncError("busy");
    }

    if (snapshot.session.status === "anonymous") {
      const generation = this.generation;
      this.update({ busy: true });
      try {
        await this.storage.exclusive(
          () => {
            this.assertActive(generation, this.controller.signal);
            const stored = this.storage.read(this.anonymous);
            this.anonymous = next(stored.list);
            this.update({
              anonymousList: this.anonymous,
              warning: this.storage.write(this.anonymous) || stored.warning,
            });
          },
          this.controller.signal,
          false,
        );
      } finally {
        this.finishSequence(generation);
      }
      return;
    }

    if (!this.remote || snapshot.session.status !== "authenticated" || this.expired) {
      throw new ShoppingListSyncError("expired");
    }

    const operation = operationForChange(this.remote.list, next(this.remote.list));
    const generation = this.generation;
    this.update({ busy: true, warning: "" });

    try {
      await this.executeMutation(operation, generation);
    } catch (error) {
      const failure = shoppingSyncFailure(error, this.expired);

      if (this.active(generation)) {
        this.update({ warning: failure.message });
      }

      throw failure;
    } finally {
      this.finishSequence(generation);
    }

    this.assertActive(generation);
  }
}
