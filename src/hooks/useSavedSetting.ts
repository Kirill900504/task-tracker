"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { readSavedSetting, subscribeSavedSetting, writeSavedSetting } from "@/lib/savedSettings";

function valueOf<T>(raw: string | null, initial: T): T {
  try { return raw === null ? initial : JSON.parse(raw) as T; } catch { return initial; }
}

// Settings belong to the signed-in person. Mounted boards and other windows
// see the same selection immediately, without waiting for a reload.
export function useSavedSetting<T>(name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const { userId } = useWorkspaceRole();
  const key = `rokas.setting.${userId || "anon"}.${name}`;
  const subscribe = useCallback((notify: () => void) => subscribeSavedSetting(key, notify), [key]);
  const snapshot = useCallback(() => readSavedSetting(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);

  function set(next: T | ((prev: T) => T)) {
    const previous = valueOf(readSavedSetting(key), initial);
    const value = typeof next === "function" ? (next as (prev: T) => T)(previous) : next;
    writeSavedSetting(key, JSON.stringify(value));
  }
  return [valueOf(raw, initial), set];
}
