// localStorage notifies other windows only. Notify this window as well so
// the two mounted mobile boards always agree about the selected filters.
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();

export function readSavedSetting(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeSavedSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // Storage denial must not stop a filter working for this session.
    memory.set(key, value);
  }
  listeners.get(key)?.forEach((notify) => notify());
}

export function subscribeSavedSetting(key: string, notify: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, set);
  set.add(notify);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      memory.delete(key);
      notify();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set.delete(notify);
    if (!set.size) listeners.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}
