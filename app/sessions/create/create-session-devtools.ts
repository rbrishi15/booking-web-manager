import type {} from "@redux-devtools/extension";
import { devtools } from "zustand/middleware";
import type { createSessionStore, CreateSessionStoreState } from "./create-session-store";

type SessionStore = ReturnType<typeof createSessionStore> & { devtools?: { cleanup(): void } };
const names = new WeakMap<SessionStore, string>();
let nextInstance = 0;

/** Attach the official middleware after commit; cleanup can be followed by reattachment. */
export function connectSessionDevtools(store: SessionStore): () => void {
  if (process.env.NODE_ENV === "production") return () => {};
  let name = names.get(store);
  if (!name) {
    name = `Session creation #${++nextInstance}`;
    names.set(store, name);
  }
  const originalSetState = store.setState;
  const originalDevtools = store.devtools;
  // Reuse the existing state/actions, rather than constructing a second store.
  const attach = devtools<CreateSessionStoreState>(() => store.getState(), { name, enabled: true });
  attach(originalSetState, store.getState, store);
  const disconnect = store.devtools?.cleanup;
  let connected = true;
  return () => {
    if (!connected) return;
    connected = false;
    disconnect?.();
    store.setState = originalSetState;
    if (originalDevtools) store.devtools = originalDevtools;
    else delete store.devtools;
  };
}
