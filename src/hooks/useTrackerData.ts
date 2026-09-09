"use client";

// React port of legacy-tracker.js's data/sync layer (persistAll, diffAndSync,
// softDeleteRow/restoreRow, setupRealtime, the 15s retry-on-failure). Ported
// faithfully rather than redesigned — see public/legacy-tracker.js's own
// comments for the history of the two bugs this design already fixes:
// 1) shadow must be a deep clone, never the same object references as the
//    live list (see snapshotList() in trackerSync.ts).
// 2) a failed save must not be silently forgotten — it must stay visible and
//    retry until it lands, and sign-out/tab-close must wait for/warn about
//    pending writes rather than let the browser abort them mid-flight.
//
// React's immutable state model (every action below builds a brand-new
// array/object rather than mutating one in place) removes the *original*
// class of bug by construction: there is no code path left that can mutate
// an object already sitting in `shadowRef`, because nothing is ever mutated
// in place at all. The explicit snapshotList() clone is kept anyway — belt
// and suspenders, and it keeps this module's contract identical to the
// legacy one it's replacing.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isRoutedThroughProxy } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffAssignees, diffRows, removeById, snapshotList, upsertById } from "@/lib/trackerSync";
import { refreshRecurringStatuses } from "@/lib/taskDisplay";
import {
  DEFAULT_ASSIGNEES,
  DEFAULT_PANEL_LAYOUT,
  ideaFromRow,
  ideaToRow,
  meetingFromRow,
  meetingToRow,
  sectionFromRow,
  sectionToRow,
  taskFromRow,
  taskToRow,
  type IdeaRow,
  type MeetingRow,
  type SectionRow,
  type TaskRow,
} from "@/lib/trackerRows";
import type { Idea, Meeting, PanelLayout, Section, Task } from "@/types/tracker";
import { clearSnapshot, loadSnapshot, saveSnapshot, type Snapshot, type TrackerLists } from "@/lib/offlineStore";
import { applyLocalChanges, applyLocalNameChanges, hasUnsyncedWork } from "@/lib/offlineMerge";
import { cacheShell } from "@/lib/shellCache";

type Shadow = {
  tasks: Task[];
  meetings: Meeting[];
  ideas: Idea[];
  assignees: string[];
  sections: Section[];
};

export interface SyncStatus {
  pending: boolean;
  // True while the tracker is running on its offline copy: it started
  // without a connection (or lost it), so what you see came from
  // IndexedDB and what you change is waiting to be sent.
  // Non-null while a save has failed and is waiting to retry — the UI
  // should keep this visible (not auto-hide it) until it clears.
  lastError: string | null;
  // False until the first write of the session, so a freshly loaded page
  // doesn't show a "✓ Сохранено" pill for something that never happened.
  everSaved: boolean;
}

const LAST_USER_KEY = "rokas-last-user";
const NETWORK_TIMEOUT_MS = 8000;
// A first start on a new device has no offline copy to fall back on, so
// there is nothing to gain by giving up quickly — and a cold start on a
// phone (waking radio, token refresh, five queries) can genuinely take
// longer than the cap above.
const SLOW_START_TIMEOUT_MS = 20000;

// Rejects rather than hanging: see boot()'s comment about connections that
// accept a request and never answer.
function withTimeout<T>(promise: Promise<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("network timeout")), ms)),
  ]);
}

function emptyShadow(): Shadow {
  return { tasks: [], meetings: [], ideas: [], assignees: [], sections: [] };
}

export function useTrackerData() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [panelLayout, setPanelLayoutState] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ pending: false, lastError: null, everSaved: false });
  const [offline, setOffline] = useState(false);

  const dbRef = useRef<SupabaseClient | null>(null);
  // Mirrors of the state above, read synchronously by persistAll()/
  // scheduleRetry() so they never act on a stale closure — every setter
  // below updates the ref in the same call that updates React state.
  const liveRef = useRef({ tasks, meetings, ideas, assignees, sections });
  const shadowRef = useRef<Shadow>(emptyShadow());
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCountRef = useRef(0);
  const hasPendingFailureRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets the 15s retry timer call the current persistAll without a direct
  // self-reference in its own initializer (refs must only be touched
  // outside render — see the effect right after persistAll's declaration).
  const persistAllRef = useRef<() => void>(() => {});
  const userIdRef = useRef<string | null>(null);
  const offlineRef = useRef(false);
  const realtimeReadyRef = useRef(false);
  const panelLayoutRef = useRef<PanelLayout | null>(null);
  const snapshotWritingRef = useRef(false);
  const snapshotDirtyRef = useRef(false);

  // Mirror the tracker into IndexedDB on every change. Both the live lists
  // and the shadow go in: that pair is what lets the next start tell work
  // that never reached the database from rows that merely came from it (see
  // offlineMerge.ts).
  //
  // Written straight away rather than on a debounce timer. The whole point
  // is to survive the tab being closed a moment after an edit, and a delay
  // of even a few hundred milliseconds loses exactly that case — it did,
  // measurably, in the offline test. Instead of a timer, writes are
  // coalesced: while one is in flight the next is remembered as a single
  // pending write, so a burst of edits still costs two writes, not ten, and
  // the last one always carries the latest state.
  const queueSnapshotSave = useCallback(() => {
    function write() {
      const uid = userIdRef.current;
      if (!uid) return;
      if (snapshotWritingRef.current) {
        snapshotDirtyRef.current = true;
        return;
      }
      snapshotWritingRef.current = true;
      void saveSnapshot(uid, liveRef.current as TrackerLists, shadowRef.current as TrackerLists, panelLayoutRef.current).then(() => {
        snapshotWritingRef.current = false;
        if (snapshotDirtyRef.current) {
          snapshotDirtyRef.current = false;
          write();
        }
      });
    }
    write();
  }, []);

  const persistAll = useCallback(() => {
    const db = dbRef.current;
    if (!db) return;

    // Every step below reads liveRef at the moment it *runs*, never a
    // snapshot taken here at call time. legacy-tracker.js read its live
    // arrays the same way, and the difference matters: two actions in one
    // tick (saving a meeting and consuming the idea it came from, say)
    // queue two persistAll runs, and a stale snapshot would both re-upsert
    // rows the second action had already removed and then overwrite shadow
    // with that stale list — after which the next diff reads as "this row
    // was deleted" and issues a hard DELETE for a row that should only ever
    // be soft-deleted. Same family as the shared-shadow bug in the header
    // comment: shadow must always describe what was actually just synced.
    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null, everSaved: true });
    // Written before the network is even tried, so the change survives the
    // tab being closed while the save is still in flight or failing.
    queueSnapshotSave();
    let hadError = false;

    syncChainRef.current = syncChainRef.current
      .then(async () => {
        const sectionsNow = liveRef.current.sections;
        const { upserts, deleteIds } = diffRows(sectionsNow, shadowRef.current.sections, sectionToRow);
        if (upserts.length) {
          const { error } = await db.from("sections").upsert(upserts as SectionRow[]);
          if (error) throw error;
        }
        if (deleteIds.length) {
          const { error } = await db.from("sections").delete().in("id", deleteIds);
          if (error) throw error;
        }
        shadowRef.current.sections = snapshotList(sectionsNow);
      })
      .then(async () => {
        const tasksNow = liveRef.current.tasks;
        const { upserts, deleteIds } = diffRows(tasksNow, shadowRef.current.tasks, taskToRow);
        if (upserts.length) {
          const { error } = await db.from("tasks").upsert(upserts as TaskRow[]);
          if (error) throw error;
        }
        if (deleteIds.length) {
          const { error } = await db.from("tasks").delete().in("id", deleteIds);
          if (error) throw error;
        }
        shadowRef.current.tasks = snapshotList(tasksNow);
      })
      .then(async () => {
        const meetingsNow = liveRef.current.meetings;
        const { upserts, deleteIds } = diffRows(meetingsNow, shadowRef.current.meetings, meetingToRow);
        if (upserts.length) {
          const { error } = await db.from("meetings").upsert(upserts as MeetingRow[]);
          if (error) throw error;
        }
        if (deleteIds.length) {
          const { error } = await db.from("meetings").delete().in("id", deleteIds);
          if (error) throw error;
        }
        shadowRef.current.meetings = snapshotList(meetingsNow);
      })
      .then(async () => {
        const ideasNow = liveRef.current.ideas;
        const { upserts, deleteIds } = diffRows(ideasNow, shadowRef.current.ideas, ideaToRow);
        if (upserts.length) {
          const { error } = await db.from("ideas").upsert(upserts as IdeaRow[]);
          if (error) throw error;
        }
        if (deleteIds.length) {
          const { error } = await db.from("ideas").delete().in("id", deleteIds);
          if (error) throw error;
        }
        shadowRef.current.ideas = snapshotList(ideasNow);
      })
      .then(async () => {
        const assigneesNow = liveRef.current.assignees;
        const { added, removed } = diffAssignees(assigneesNow, shadowRef.current.assignees);
        if (added.length) {
          const { error } = await db.from("assignees").upsert(
            added.map((name) => ({ name })),
            { onConflict: "user_id,name" },
          );
          if (error) throw error;
        }
        if (removed.length) {
          const { error } = await db.from("assignees").delete().in("name", removed);
          if (error) throw error;
        }
        shadowRef.current.assignees = assigneesNow.slice();
      })
      .catch(async (err: unknown) => {
        hadError = true;
        const message = err instanceof Error ? err.message : String(err);
        console.error("Supabase sync error:", err);
        try {
          await db.from("sync_errors").insert({ message });
        } catch {
          /* best effort */
        }
      })
      .then(() => {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        hasPendingFailureRef.current = hadError;
        // Again once the chain settles: the shadow has moved on, and the
        // stored copy has to agree with it or the next start would re-send
        // work that already landed.
        queueSnapshotSave();
        setSyncStatus({
          pending: pendingCountRef.current > 0,
          lastError: hadError ? "Не сохранилось, повторю через 15с" : null,
          everSaved: true,
        });
        if (hadError) scheduleRetry();
      });
    // scheduleRetry is defined below and stable (no deps) — referenced here
    // via closure is fine since it's declared with useCallback([]) further
    // down in the same hook body, but to avoid a "used before defined" lint
    // issue it's inlined as a ref call instead.
    function scheduleRetry() {
      if (retryTimerRef.current) return;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (hasPendingFailureRef.current) persistAllRef.current();
      }, 15000);
    }
  }, [queueSnapshotSave]);

  useEffect(() => {
    persistAllRef.current = persistAll;
  }, [persistAll]);

  // ---- Soft delete / restore — bypass the diff entirely, same reasoning as
  // legacy-tracker.js's softDeleteRow()/restoreRow(): an ordinary upsert
  // must never touch deleted_at, or a stale/late write could resurrect a row
  // deleted elsewhere in the meantime. Chained on the same syncChainRef and
  // counted the same way, so sign-out/beforeunload wait for these too.
  const softDeleteRow = useCallback((table: string, id: string) => {
    const db = dbRef.current;
    if (!db) return;
    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null, everSaved: true });
    syncChainRef.current = syncChainRef.current
      .then(async () => {
        const { error } = await db.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
      })
      .catch((err: unknown) => {
        console.error("Soft delete error:", err);
      })
      .then(() => {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        setSyncStatus({ pending: pendingCountRef.current > 0, lastError: null, everSaved: true });
      });
  }, []);

  const restoreRow = useCallback((table: string, id: string) => {
    const db = dbRef.current;
    if (!db) return;
    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null, everSaved: true });
    syncChainRef.current = syncChainRef.current
      .then(async () => {
        const { error } = await db.from(table).update({ deleted_at: null }).eq("id", id);
        if (error) throw error;
      })
      .catch((err: unknown) => {
        console.error("Restore error:", err);
      })
      .then(() => {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        setSyncStatus({ pending: pendingCountRef.current > 0, lastError: null, everSaved: true });
      });
  }, []);

  const savePanelLayout = useCallback((layout: PanelLayout) => {
    setPanelLayoutState(layout);
    panelLayoutRef.current = layout;
    const db = dbRef.current;
    if (!db) return;
    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null, everSaved: true });
    syncChainRef.current = syncChainRef.current
      .then(async () => {
        const { error } = await db.from("user_prefs").upsert({ panel_layout: layout, updated_at: new Date().toISOString() });
        if (error) throw error;
      })
      .catch((err: unknown) => {
        console.error("Save layout error:", err);
      })
      .then(() => {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        setSyncStatus({ pending: pendingCountRef.current > 0, lastError: null, everSaved: true });
      });
  }, []);

  // ---- Generic "replace one list, keep the ref mirror in sync, persist"
  // helpers used by every per-entity action below. Each only closes over
  // `persistAll` (stable, see above) so these are stable too.
  const commitTasks = useCallback((next: Task[]) => {
    liveRef.current.tasks = next;
    setTasks(next);
    persistAll();
  }, [persistAll]);
  const commitMeetings = useCallback((next: Meeting[]) => {
    liveRef.current.meetings = next;
    setMeetings(next);
    persistAll();
  }, [persistAll]);
  const commitIdeas = useCallback((next: Idea[]) => {
    liveRef.current.ideas = next;
    setIdeas(next);
    persistAll();
  }, [persistAll]);
  const commitAssignees = useCallback((next: string[]) => {
    liveRef.current.assignees = next;
    setAssignees(next);
    persistAll();
  }, [persistAll]);
  const commitSections = useCallback((next: Section[]) => {
    liveRef.current.sections = next;
    setSections(next);
    persistAll();
  }, [persistAll]);

  // ---- Task actions
  const saveTask = useCallback((task: Task) => commitTasks(upsertById(liveRef.current.tasks, task)), [commitTasks]);
  const deleteTask = useCallback((id: string) => {
    commitTasks(removeById(liveRef.current.tasks, id));
    shadowRef.current.tasks = removeById(shadowRef.current.tasks, id);
    softDeleteRow("tasks", id);
  }, [commitTasks, softDeleteRow]);
  const restoreTask = useCallback((task: Task) => {
    commitTasks(upsertById(liveRef.current.tasks, task));
    restoreRow("tasks", task.id);
  }, [commitTasks, restoreRow]);

  // ---- Meeting actions
  const saveMeeting = useCallback((meeting: Meeting) => commitMeetings(upsertById(liveRef.current.meetings, meeting)), [commitMeetings]);
  const deleteMeeting = useCallback((id: string) => {
    commitMeetings(removeById(liveRef.current.meetings, id));
    shadowRef.current.meetings = removeById(shadowRef.current.meetings, id);
    softDeleteRow("meetings", id);
  }, [commitMeetings, softDeleteRow]);
  const restoreMeeting = useCallback((meeting: Meeting) => {
    commitMeetings(upsertById(liveRef.current.meetings, meeting));
    restoreRow("meetings", meeting.id);
  }, [commitMeetings, restoreRow]);

  // ---- Idea actions
  const saveIdea = useCallback((idea: Idea) => commitIdeas(upsertById(liveRef.current.ideas, idea)), [commitIdeas]);
  const deleteIdea = useCallback((id: string) => {
    commitIdeas(removeById(liveRef.current.ideas, id));
    shadowRef.current.ideas = removeById(shadowRef.current.ideas, id);
    softDeleteRow("ideas", id);
  }, [commitIdeas, softDeleteRow]);
  const restoreIdea = useCallback((idea: Idea) => {
    commitIdeas(upsertById(liveRef.current.ideas, idea));
    restoreRow("ideas", idea.id);
  }, [commitIdeas, restoreRow]);

  // ---- Section actions
  const saveSection = useCallback((section: Section) => commitSections(upsertById(liveRef.current.sections, section)), [commitSections]);
  const deleteSection = useCallback((id: string) => commitSections(removeById(liveRef.current.sections, id)), [commitSections]);

  // ---- Assignee actions
  const addAssignee = useCallback((name: string) => {
    if (!name || liveRef.current.assignees.includes(name)) return;
    commitAssignees([...liveRef.current.assignees, name]);
  }, [commitAssignees]);
  const removeAssignee = useCallback((name: string) => {
    commitAssignees(liveRef.current.assignees.filter((a) => a !== name));
  }, [commitAssignees]);

  // ---- Sign out: waits for every queued write (persistAll's diffAndSync,
  // plus softDeleteRow/restoreRow/savePanelLayout, all chained on the same
  // syncChainRef) to actually reach Supabase before navigating away. This is
  // the fix for "I edited something, signed out immediately, and it was
  // gone" — the browser aborts in-flight requests on navigation, so signing
  // out first could discard a save that hadn't landed yet.
  const signOut = useCallback(async (): Promise<{ ok: true } | { ok: false; reason: "pending-failure" | "error"; message?: string }> => {
    const db = dbRef.current;
    if (!db) return { ok: false, reason: "error", message: "not initialized" };
    await syncChainRef.current;
    // syncChainRef resolves even after a failed save (persistAll's own
    // .catch() swallows the error so the queue keeps moving) — waiting for
    // it to settle doesn't mean the save actually succeeded. Check the flag.
    if (hasPendingFailureRef.current) {
      return { ok: false, reason: "pending-failure" };
    }
    const { error } = await db.auth.signOut();
    if (error) return { ok: false, reason: "error", message: error.message };
    if (userIdRef.current) await clearSnapshot(userIdRef.current);
    router.push("/login");
    return { ok: true };
  }, [router]);

  // Which account this browser last had open, so a start with no readable
  // session still knows whose offline copy to show.
  function lastUserId(): string | null {
    try {
      return localStorage.getItem(LAST_USER_KEY);
    } catch {
      return null;
    }
  }
  function rememberUserId(uid: string) {
    try {
      localStorage.setItem(LAST_USER_KEY, uid);
    } catch {
      /* private window — offline start will just ask for sign-in */
    }
  }

  // ---- Boot: load auth session, initial data, panel layout, seed shadow,
  // subscribe to realtime. Mirrors legacy-tracker.js's boot() function.
  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    dbRef.current = db;

    let booting = false;
    async function boot() {
      if (booting) return;
      booting = true;
      try {
        await bootOnce();
      } finally {
        booting = false;
      }
    }

    async function bootOnce() {
      // Reading the session can itself need the network (an expired token is
      // refreshed over it), and a connection that accepts requests but never
      // answers — a captive wifi, a dead spot with full bars — would leave
      // the app on "Загрузка…" forever. Every network step below is capped,
      // and a cap means the offline copy, not an error.
      let session = null;
      try {
        const { data: sessionData } = await withTimeout(db.auth.getSession());
        session = sessionData.session;
      } catch {
        session = null;
      }
      if (cancelled) return;

      if (!session) {
        // No readable session. Offline that means the last user's copy is
        // still the right thing to show; online it means sign in.
        const lastUid = lastUserId();
        const lastCache = lastUid ? await loadSnapshot(lastUid) : null;
        if (lastCache && !navigator.onLine) {
          setUserId(lastUid);
          userIdRef.current = lastUid;
          startFromCache(lastCache);
          return;
        }
        router.push("/login");
        return;
      }

      const uid = session.user.id;
      setUserId(uid);
      userIdRef.current = uid;
      rememberUserId(uid);

      // What the last session left behind — read before the network, so a
      // start without a connection has something to show straight away.
      const cached = await loadSnapshot(uid);

      const loadAll = (ms?: number) =>
        withTimeout(
          Promise.all([
            db.from("tasks").select("*").is("deleted_at", null),
            db.from("meetings").select("*").is("deleted_at", null),
            db.from("ideas").select("*").is("deleted_at", null).order("created_at", { ascending: true }),
            db.from("assignees").select("*").order("created_at", { ascending: true }),
            db.from("sections").select("*").order("sort_order", { ascending: true }),
          ]),
          ms,
        );

      let results;
      try {
        results = await loadAll();
      } catch {
        if (cancelled) return;
        if (cached) {
          startFromCache(cached);
          return;
        }
        // Nothing stored to show instead, so being patient costs nothing and
        // saves the start: on a phone opening the installed app cold, the
        // first attempt can time out on a connection that is perfectly fine.
        try {
          results = await loadAll(SLOW_START_TIMEOUT_MS);
        } catch {
          if (cancelled) return;
          failLoad("Нет связи с облаком");
          return;
        }
      }
      if (cancelled) return;

      const failed = results.find((r) => r.error);
      if (failed) {
        // Unreachable database — usually just no connection. Run on the
        // offline copy instead of showing an error page: everything changed
        // from here is stored locally and pushed by the usual retry (and by
        // the `online` listener below) once the network is back.
        if (cached) {
          startFromCache(cached);
          return;
        }
        failLoad(failed.error!.message);
        return;
      }

      let loadedTasks = (results[0].data as TaskRow[]).map(taskFromRow);
      let loadedMeetings = (results[1].data as MeetingRow[]).map(meetingFromRow);
      let loadedIdeas = (results[2].data as IdeaRow[]).map(ideaFromRow);
      let loadedAssignees = (results[3].data as { name: string }[]).map((r) => r.name);
      let loadedSections = (results[4].data as SectionRow[]).map(sectionFromRow);

      // Baseline "already in the database" snapshot, taken before any
      // startup reconciliation below, so persistAll() only pushes what's
      // genuinely new (default-assignee seeding, back-filled names).
      shadowRef.current = {
        tasks: snapshotList(loadedTasks),
        meetings: snapshotList(loadedMeetings),
        ideas: snapshotList(loadedIdeas),
        assignees: loadedAssignees.slice(),
        sections: snapshotList(loadedSections),
      };

      // Work from a previous session that never reached the database is
      // re-applied on top of what the server has now — item by item, so a
      // row changed on another device in the meantime is not overwritten by
      // a stale local copy of it (see offlineMerge.ts).
      if (cached && hasUnsyncedWork(cached.live as unknown as Record<string, unknown[]>, cached.shadow as unknown as Record<string, unknown[]>)) {
        loadedTasks = applyLocalChanges(loadedTasks, cached.live.tasks, cached.shadow.tasks);
        loadedMeetings = applyLocalChanges(loadedMeetings, cached.live.meetings, cached.shadow.meetings);
        loadedIdeas = applyLocalChanges(loadedIdeas, cached.live.ideas, cached.shadow.ideas);
        loadedSections = applyLocalChanges(loadedSections, cached.live.sections, cached.shadow.sections);
        loadedAssignees = applyLocalNameChanges(loadedAssignees, cached.live.assignees, cached.shadow.assignees);
      }

      if (loadedAssignees.length === 0) loadedAssignees = DEFAULT_ASSIGNEES.slice();
      loadedTasks.forEach((t) => {
        if (t.assignee && !loadedAssignees.includes(t.assignee)) loadedAssignees.push(t.assignee);
      });

      // A recurring task completed in a past period shows as open again
      // (see src/lib/taskDisplay.ts's refreshRecurringStatuses) — done
      // *after* the shadow baseline above, exactly like legacy-tracker.js's
      // boot(), so the reset itself is treated as a real change to sync.
      const { tasks: recurRefreshedTasks } = refreshRecurringStatuses(loadedTasks);

      liveRef.current = {
        tasks: recurRefreshedTasks,
        meetings: loadedMeetings,
        ideas: loadedIdeas,
        assignees: loadedAssignees,
        sections: loadedSections,
      };
      setTasks(recurRefreshedTasks);
      setMeetings(loadedMeetings);
      setIdeas(loadedIdeas);
      setAssignees(loadedAssignees);
      setSections(loadedSections);

      try {
        const prefsRes = await db.from("user_prefs").select("panel_layout").maybeSingle();
        if (!cancelled) {
          const layout = (prefsRes.data?.panel_layout as PanelLayout) || DEFAULT_PANEL_LAYOUT;
          setPanelLayoutState(layout);
          panelLayoutRef.current = layout;
        }
      } catch {
        if (!cancelled) setPanelLayoutState(DEFAULT_PANEL_LAYOUT);
      }

      setOffline(false);
      offlineRef.current = false;
      setLoadError(null);
      setLoading(false);
      subscribeRealtime(uid);
      persistAllRef.current(); // sync seeded/back-filled assignees and any offline work
      // Now that the tracker has loaded for real, keep a copy of its shell for
      // the next start without a connection.
      void cacheShell();
    }

    // Data that could not be loaded and has no stored copy. The reason is
    // shown, but the app also goes on trying: the periodic retry below only
    // runs while it considers itself offline, and without that flag an
    // error screen was a dead end with no way back — which is what a cold
    // start on the phone ran into.
    function failLoad(message: string) {
      setLoadError(message);
      setLoading(false);
      setOffline(true);
      offlineRef.current = true;
    }

    // Everything the last session had, straight from IndexedDB. The shadow
    // goes back exactly as it was stored, so the difference between the two
    // is still the unsent work — and the ordinary retry will send it.
    function startFromCache(cached: Snapshot) {
      liveRef.current = {
        tasks: cached.live.tasks,
        meetings: cached.live.meetings,
        ideas: cached.live.ideas,
        assignees: cached.live.assignees,
        sections: cached.live.sections,
      };
      shadowRef.current = {
        tasks: cached.shadow.tasks,
        meetings: cached.shadow.meetings,
        ideas: cached.shadow.ideas,
        assignees: cached.shadow.assignees,
        sections: cached.shadow.sections,
      };
      setTasks(cached.live.tasks);
      setMeetings(cached.live.meetings);
      setIdeas(cached.live.ideas);
      setAssignees(cached.live.assignees);
      setSections(cached.live.sections);
      if (cached.panelLayout) {
        setPanelLayoutState(cached.panelLayout);
        panelLayoutRef.current = cached.panelLayout;
      }
      setOffline(true);
      offlineRef.current = true;
      setLoadError(null);
      setLoading(false);
    }

    // ---- Realtime: merge changes from another tab/device into both the
    // live list and a CLONED copy in shadow (never the same object
    // reference — see snapshotList()'s doc comment for why).
    function subscribeRealtime(uid: string) {
      if (realtimeReadyRef.current) return;
      // On a network that cannot reach Supabase directly the tracker runs
      // over our own origin instead (see src/lib/supabase/client.ts) — and a
      // websocket is the one thing that cannot go that way. Not subscribing
      // is what already happens there; doing it deliberately just saves the
      // radio a reconnection attempt every few seconds for nothing.
      if (isRoutedThroughProxy()) return;

      realtimeReadyRef.current = true;
      const filter = `user_id=eq.${uid}`;
      db.channel("tracker-sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter }, (payload) => {
          if (payload.eventType === "DELETE" || (payload.new as { deleted_at?: string })?.deleted_at) {
            const id = (payload.old as { id: string })?.id ?? (payload.new as { id: string }).id;
            liveRef.current.tasks = removeById(liveRef.current.tasks, id);
            shadowRef.current.tasks = removeById(shadowRef.current.tasks, id);
          } else {
            const t = taskFromRow(payload.new as TaskRow);
            liveRef.current.tasks = upsertById(liveRef.current.tasks, t);
            shadowRef.current.tasks = upsertById(shadowRef.current.tasks, snapshotList([t])[0]);
          }
          setTasks(liveRef.current.tasks);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "meetings", filter }, (payload) => {
          if (payload.eventType === "DELETE" || (payload.new as { deleted_at?: string })?.deleted_at) {
            const id = (payload.old as { id: string })?.id ?? (payload.new as { id: string }).id;
            liveRef.current.meetings = removeById(liveRef.current.meetings, id);
            shadowRef.current.meetings = removeById(shadowRef.current.meetings, id);
          } else {
            const m = meetingFromRow(payload.new as MeetingRow);
            liveRef.current.meetings = upsertById(liveRef.current.meetings, m);
            shadowRef.current.meetings = upsertById(shadowRef.current.meetings, snapshotList([m])[0]);
          }
          setMeetings(liveRef.current.meetings);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "ideas", filter }, (payload) => {
          if (payload.eventType === "DELETE" || (payload.new as { deleted_at?: string })?.deleted_at) {
            const id = (payload.old as { id: string })?.id ?? (payload.new as { id: string }).id;
            liveRef.current.ideas = removeById(liveRef.current.ideas, id);
            shadowRef.current.ideas = removeById(shadowRef.current.ideas, id);
          } else {
            const i = ideaFromRow(payload.new as IdeaRow);
            liveRef.current.ideas = upsertById(liveRef.current.ideas, i);
            shadowRef.current.ideas = upsertById(shadowRef.current.ideas, snapshotList([i])[0]);
          }
          setIdeas(liveRef.current.ideas);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "assignees", filter }, (payload) => {
          if (payload.eventType === "DELETE") {
            const name = (payload.old as { name: string }).name;
            liveRef.current.assignees = liveRef.current.assignees.filter((a) => a !== name);
            shadowRef.current.assignees = shadowRef.current.assignees.filter((a) => a !== name);
          } else {
            const name = (payload.new as { name: string }).name;
            if (!liveRef.current.assignees.includes(name)) liveRef.current.assignees = [...liveRef.current.assignees, name];
            if (!shadowRef.current.assignees.includes(name)) shadowRef.current.assignees = [...shadowRef.current.assignees, name];
          }
          setAssignees(liveRef.current.assignees);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "sections", filter }, (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            liveRef.current.sections = removeById(liveRef.current.sections, id);
            shadowRef.current.sections = removeById(shadowRef.current.sections, id);
          } else {
            const s = sectionFromRow(payload.new as SectionRow);
            liveRef.current.sections = upsertById(liveRef.current.sections, s);
            shadowRef.current.sections = upsertById(shadowRef.current.sections, snapshotList([s])[0]);
          }
          setSections(liveRef.current.sections);
        })
        .subscribe();
    }

    boot();

    // Back on the network: an offline start has no server data and no
    // realtime subscription, so it re-runs the whole boot — which reads the
    // cache again (the offline work is in it by now) and merges. A normal
    // session that merely lost a save just retries it, instead of sitting
    // out the remaining 15 seconds.
    function onOnline() {
      if (cancelled) return;
      if (offlineRef.current) boot();
      else if (hasPendingFailureRef.current) persistAllRef.current();
    }
    window.addEventListener("online", onOnline);

    // The event is not enough on its own: it reports the operating system's
    // idea of a connection, which says nothing about whether anything can
    // actually be reached (hotel wifi, a captive portal, a VPN coming back).
    // So while running on the offline copy, simply try again periodically.
    const offlineRetry = setInterval(() => {
      if (!cancelled && offlineRef.current) boot();
    }, 15000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      clearInterval(offlineRetry);
    };
    // Intentionally run once on mount — re-running boot() on every render
    // would re-subscribe realtime channels and re-fetch everything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Warn before closing/reloading the tab with unsaved or unsent work —
  // can't await a promise here, but the browser's native confirm at least
  // gives the user a chance to cancel and let the save finish.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (pendingCountRef.current > 0 || hasPendingFailureRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return {
    loading,
    loadError,
    userId,
    tasks,
    meetings,
    ideas,
    assignees,
    sections,
    panelLayout,
    syncStatus,
    offline,
    actions: {
      saveTask,
      deleteTask,
      restoreTask,
      saveMeeting,
      deleteMeeting,
      restoreMeeting,
      saveIdea,
      deleteIdea,
      restoreIdea,
      saveSection,
      deleteSection,
      addAssignee,
      removeAssignee,
      savePanelLayout,
      signOut,
    },
  };
}
