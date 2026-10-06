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

type Snapshot = {
  list: ShoppingList;
  warning: string;
  ready: boolean;
  busy: boolean;
  key: string | null | undefined;
  accountKnown: boolean;
};
type Storage = {
  read: (fallback: ShoppingList) => { list: ShoppingList; warning: string };
  write: (list: ShoppingList) => string;
  claim: (owner: string) => boolean;
  clear: (list: ShoppingList, owner: string) => boolean;
};
const unavailable = "No pudimos sincronizar tu lista. Intenta nuevamente.";
const expired = "Tu sesión ya no está disponible. Inicia sesión nuevamente para sincronizar.";
export class ShoppingListSyncClient {
  private snapshot: Snapshot = {
    list: emptyShoppingList(),
    warning: "",
    ready: false,
    busy: false,
    key: undefined,
    accountKnown: false,
  };
  private remote: RemoteShoppingListState | null = null;
  private anonymous = emptyShoppingList();
  private generation = 0;
  private controller = new AbortController();
  private listeners = new Set<() => void>();
  private refreshAgain = false;
  private expired = false;
  constructor(
    private storage: Storage,
    private request: typeof fetch,
    private broadcast: () => void,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  setSession(key: string | null | undefined) {
    if (key === this.snapshot.key) return;
    this.controller.abort();
    this.controller = new AbortController();
    this.generation++;
    this.remote = null;
    this.expired = false;
    this.refreshAgain = false;
    this.update({
      key,
      accountKnown: key === undefined ? this.snapshot.accountKnown : key !== null,
      list: emptyShoppingList(),
      warning: "",
      ready: false,
      busy: false,
    });
    if (key === undefined) return;
    if (key === null) {
      const stored = this.storage.read(this.anonymous);
      this.anonymous = stored.list;
      this.update({ ...stored, ready: true });
    } else void this.refresh();
  }
  storageChanged() {
    if (this.snapshot.key === null) {
      const stored = this.storage.read(this.anonymous);
      this.anonymous = stored.list;
      this.update({ ...stored, ready: true });
    } else if (this.snapshot.key) void this.refresh(false);
  }
  private async response(response: Response): Promise<RemoteShoppingListState> {
    if (response.status === 401) {
      this.expired = true;
      this.remote = null;
      this.update({ list: emptyShoppingList(), ready: false, warning: expired });
      throw new Error(expired);
    }
    if (!response.ok) throw new Error(unavailable);
    return remoteShoppingListStateSchema.parse(await response.json());
  }
  private active(generation: number) {
    return generation === this.generation;
  }
  private async mutate(operation: ShoppingListSyncOperation, generation: number) {
    let pending = shoppingListSyncOperationSchema.parse(operation);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.active(generation) || !this.remote) throw new Error(unavailable);
      const expected =
        pending.type === "save"
          ? saveShoppingItem(this.remote.list, pending.item)
          : removeShoppingItem(this.remote.list, pending.id);
      const revision =
        this.remote.revision +
        (pending.type === "save" || expected.items.length !== this.remote.list.items.length
          ? 1
          : 0);
      const response = await this.request("/api/list/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: this.remote.revision, operation: pending }),
        signal: this.controller.signal,
      });
      if (!this.active(generation)) throw new Error(unavailable);
      if (response.status === 409) {
        const conflict = shoppingListRevisionConflictSchema.parse(await response.json());
        if (!this.active(generation)) throw new Error(unavailable);
        this.remote = conflict.current;
        this.update({ list: this.remote.list });
        if (attempt === 1)
          throw new Error("Tu lista cambió en otra pestaña o dispositivo. Intenta nuevamente.");
        if (pending.type === "save") {
          const replanned = shoppingImportOperation(this.remote.list, pending.item);
          if (!replanned) return;
          pending = replanned;
        }
      } else {
        const state = await this.response(response);
        if (!this.active(generation)) throw new Error(unavailable);
        if (state.revision !== revision || JSON.stringify(state.list) !== JSON.stringify(expected))
          throw new Error(unavailable);
        this.remote = state;
        this.update({ list: state.list });
        this.broadcast();
        return;
      }
    }
  }
  async refresh(importAnonymous = true) {
    if (!this.snapshot.key || this.expired) return;
    if (this.snapshot.busy) {
      this.refreshAgain = true;
      return;
    }
    const generation = this.generation;
    const owner = this.snapshot.key.split(":")[0]!;
    this.update({ busy: true, warning: importAnonymous ? "" : this.snapshot.warning });
    try {
      const response = await this.request("/api/list/sync", {
        cache: "no-store",
        credentials: "same-origin",
        signal: this.controller.signal,
      });
      if (!this.active(generation)) return;
      const state = await this.response(response);
      if (!this.active(generation)) return;
      this.remote = state;
      this.update({ list: state.list, ready: true });
      if (!importAnonymous) return;
      const stored = this.storage.read(this.anonymous);
      this.anonymous = stored.list;
      if (stored.warning) {
        this.update({ warning: stored.warning });
        return;
      }
      if (!stored.list.items.length) return;
      if (!this.storage.claim(owner)) {
        this.update({
          warning:
            "La lista de este navegador tiene una importación pendiente de otra cuenta o el almacenamiento no está disponible.",
        });
        return;
      }
      let incomplete = false;
      for (const item of stored.list.items) {
        if (!this.active(generation) || !this.remote) return;
        let operation;
        try {
          operation = shoppingImportOperation(this.remote.list, item);
        } catch {
          incomplete = true;
          continue;
        }
        if (operation) await this.mutate(operation, generation);
      }
      if (!this.active(generation)) return;
      if (incomplete || !this.storage.clear(stored.list, owner)) {
        this.update({
          warning:
            "Conservamos la lista de este navegador: la importación está incompleta. Revisa el límite de 50 necesidades e intenta nuevamente.",
        });
      } else this.anonymous = emptyShoppingList();
    } catch (error) {
      if (this.active(generation))
        this.update({
          warning: this.expired
            ? expired
            : error instanceof Error && error.message.startsWith("Tu lista cambió")
              ? error.message
              : unavailable,
        });
    } finally {
      if (this.active(generation)) {
        this.update({ busy: false });
        if (this.refreshAgain && !this.expired) {
          this.refreshAgain = false;
          void this.refresh(false);
        }
      }
    }
  }
  async change(next: (current: ShoppingList) => ShoppingList) {
    if (!this.snapshot.ready || this.snapshot.busy)
      throw new Error("Espera a que termine la sincronización de tu lista.");
    if (this.snapshot.key === null) {
      const stored = this.storage.read(this.anonymous);
      this.anonymous = next(stored.list);
      this.update({
        list: this.anonymous,
        warning: this.storage.write(this.anonymous) || stored.warning,
      });
      return;
    }
    if (!this.remote || !this.snapshot.key || this.expired) throw new Error(expired);
    const previous = this.remote.list;
    const changed = next(previous);
    const removed = previous.items.filter((i) => !changed.items.some((n) => n.id === i.id));
    const saved = changed.items.filter(
      (i) => JSON.stringify(i) !== JSON.stringify(previous.items.find((p) => p.id === i.id)),
    );
    if (removed.length + saved.length !== 1)
      throw new Error("Guarda o elimina una necesidad a la vez.");
    const operation: ShoppingListSyncOperation = saved[0]
      ? { type: "save", item: saved[0] }
      : { type: "remove", id: removed[0]!.id };
    const generation = this.generation;
    this.update({ busy: true, warning: "" });
    try {
      await this.mutate(operation, generation);
    } catch (error) {
      const message = this.expired
        ? expired
        : error instanceof Error && error.message.startsWith("Tu lista cambió")
          ? error.message
          : unavailable;
      if (this.active(generation)) this.update({ warning: message });
      throw new Error(message, { cause: error });
    } finally {
      if (this.active(generation)) {
        this.update({ busy: false });
        if (this.refreshAgain && !this.expired) {
          this.refreshAgain = false;
          void this.refresh(false);
        }
      }
    }
    if (!this.active(generation)) throw new Error("La cuenta cambió. Vuelve a abrir el editor.");
  }
}
