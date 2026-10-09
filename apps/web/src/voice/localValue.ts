// Small per-device settings kept in localStorage, readable with useSyncExternalStore.
// Storage can be missing or throw (private mode, blocked storage): every access is guarded,
// and the app then behaves as if nothing was saved.

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not saved; the choice still applies for this page view through the listeners below.
  }
  listeners.get(key)?.forEach((l) => l());
}

export function subscribeLocal(key: string, listener: Listener): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.get(key)?.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
