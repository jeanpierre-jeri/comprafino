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
import { sameShoppingSession } from "./session";
import type { ShoppingSession } from "./session";
import { ShoppingListSyncError, shoppingSyncFailure } from "./sync-errors";

export type ShoppingListClientState = {
  anonymousList: ShoppingList;
  warning: string;
  ready: boolean;
  busy: boolean;
  session: ShoppingSession;
};

type ShoppingStorage = {
  read: (fallback: ShoppingList) => { list: ShoppingList; warning: string };
  write: (list: ShoppingList) => string;
  claim: (owner: string) => boolean;
  clear: (list: ShoppingList, owner: string) => boolean;
};

type RefreshMode = "read-only" | "import-anonymous";

const pendingImportMessage =
  "La lista de este navegador tiene una importación pendiente de otra cuenta o el almacenamiento no está disponible.";

const incompleteImportMessage =
  "Conservamos la lista de este navegador: la importación está incompleta. Revisa el límite de 50 necesidades e intenta nuevamente.";

function initialSnapshot(): ShoppingListClientState {
  return {
    anonymousList: emptyShoppingList(),
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

  constructor(
    private storage: ShoppingStorage,
    private request: typeof fetch,
    private broadcast: () => void,
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
    this.update(initialSnapshot());
  }

  setSession(session: ShoppingSession) {
    if (sameShoppingSession(session, this.getSnapshot().session)) return;

    this.controller.abort();
    this.controller = new AbortController();
    this.generation++;
    this.clearServerState();
    this.expired = false;
    this.refreshAgain = false;
    this.update({ session, warning: "", ready: false, busy: false });

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

  private assertActive(generation: number) {
    if (!this.active(generation)) {
      throw new ShoppingListSyncError("accountChanged");
    }
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

  private async mutate(operation: ShoppingListSyncOperation, generation: number) {
    let pending = shoppingListSyncOperationSchema.parse(operation);

    // One initial attempt and one replay; every await is guarded by session generation.
    for (let attempt = 0; attempt < 2; attempt++) {
      this.assertActive(generation);

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
        signal: this.controller.signal,
      });
      this.assertActive(generation);

      if (response.status === 409) {
        const conflict = shoppingListRevisionConflictSchema.parse(await response.json());
        this.assertActive(generation);
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

      const state = await this.parseResponse(response);
      this.assertActive(generation);

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
      queryFn: async ({ signal }) => {
        this.assertActive(generation);
        const response = await this.request("/api/list/sync", {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        });
        this.assertActive(generation);

        const state = await this.parseResponse(response);
        this.assertActive(generation);
        return state;
      },
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
        this.mutate(input.operation, input.generation),
      retry: false,
      networkMode: "always",
      gcTime: 0,
    });
    try {
      await mutation.mutate({ operation, generation });
    } finally {
      mutation.reset();
    }
  }

  private async persistAnonymous(owner: string, generation: number) {
    this.assertActive(generation);
    const stored = this.storage.read(this.anonymous);
    this.anonymous = stored.list;

    if (stored.warning) {
      this.update({ warning: stored.warning });

      return;
    }

    if (!stored.list.items.length) return;

    if (!this.storage.claim(owner)) {
      this.update({ warning: pendingImportMessage });

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

    if (incomplete || !this.storage.clear(stored.list, owner)) {
      this.update({ warning: incompleteImportMessage });

      return;
    }

    this.anonymous = emptyShoppingList();
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

    const generation = this.generation;
    const warning = mode === "import-anonymous" ? "" : snapshot.warning;
    this.update({ busy: true, warning });

    try {
      await this.readRemote(generation);

      if (mode === "import-anonymous") {
        await this.persistAnonymous(snapshot.session.userId, generation);
      }
    } catch (error) {
      if (this.active(generation)) {
        this.update({ warning: shoppingSyncFailure(error, this.expired).message });
      }
    } finally {
      this.finishSequence(generation);
    }
  }

  async change(next: (current: ShoppingList) => ShoppingList) {
    const snapshot = this.getSnapshot();

    if (!snapshot.ready || snapshot.busy) {
      throw new ShoppingListSyncError("busy");
    }

    if (snapshot.session.status === "anonymous") {
      const stored = this.storage.read(this.anonymous);
      this.anonymous = next(stored.list);
      this.update({
        anonymousList: this.anonymous,
        warning: this.storage.write(this.anonymous) || stored.warning,
      });

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
