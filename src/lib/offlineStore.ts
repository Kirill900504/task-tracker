"use client";

import type { Idea, Meeting, PanelLayout, Section, Task } from "@/types/tracker";

// A copy of the tracker in IndexedDB, so the app has something to show — and
// something to send — when it starts without a connection.
//
// Two things are stored together: what is on screen (`live`) and what was
// last confirmed written (`shadow`). Keeping both is what lets the next
// start tell an offline edit apart from a row that simply came from the
// server (see offlineMerge.ts). localStorage would not do: this is the whole
// dataset, and it has to be written without blocking the UI.
//
// It is a cache and an outbox, never the source of truth — the database
// stays that. Nothing here is read once a normal load succeeds and there is
// no unsent work.

const DB_NAME = "rokas-tracker";
const DB_VERSION = 1;
const STORE = "snapshots";

export type TrackerLists = {
  tasks: Task[];
  meetings: Meeting[];
  ideas: Idea[];
  assignees: string[];
  sections: Section[];
};

export type Snapshot = {
  userId: string;
  live: TrackerLists;
  shadow: TrackerLists;
  panelLayout: PanelLayout | null;
  savedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "userId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Не удалось открыть локальное хранилище"));
  });
}

// Every call below is best-effort: a browser with storage disabled (or a
// private window that refuses IndexedDB) must not break the tracker, it just
// loses the offline copy.
export async function saveSnapshot(userId: string, live: TrackerLists, shadow: TrackerLists, panelLayout: PanelLayout | null): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      // structuredClone up front: the live arrays keep changing, and an
      // IndexedDB write is asynchronous — without a copy it can serialise a
      // list that has moved on since the call.
      tx.objectStore(STORE).put({
        userId,
        live: structuredClone(live),
        shadow: structuredClone(shadow),
        panelLayout: panelLayout ? structuredClone(panelLayout) : null,
        savedAt: new Date().toISOString(),
      } satisfies Snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* offline copy is a bonus, never a requirement */
  }
}

export async function loadSnapshot(userId: string): Promise<Snapshot | null> {
  try {
    const db = await openDb();
    const snapshot = await new Promise<Snapshot | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(userId);
      req.onsuccess = () => resolve((req.result as Snapshot) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return snapshot;
  } catch {
    return null;
  }
}

export async function clearSnapshot(userId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* nothing to clean up */
  }
}
