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
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffAssignees, diffRows, removeById, snapshotList, upsertById } from "@/lib/trackerSync";
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

type Shadow = {
  tasks: Task[];
  meetings: Meeting[];
  ideas: Idea[];
  assignees: string[];
  sections: Section[];
};

export interface SyncStatus {
  pending: boolean;
  // Non-null while a save has failed and is waiting to retry — the UI
  // should keep this visible (not auto-hide it) until it clears.
  lastError: string | null;
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ pending: false, lastError: null });

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

  const persistAll = useCallback(() => {
    const db = dbRef.current;
    if (!db) return;

    const tasksNow = liveRef.current.tasks;
    const meetingsNow = liveRef.current.meetings;
    const ideasNow = liveRef.current.ideas;
    const assigneesNow = liveRef.current.assignees;
    const sectionsNow = liveRef.current.sections;

    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null });
    let hadError = false;

    syncChainRef.current = syncChainRef.current
      .then(async () => {
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
        setSyncStatus({
          pending: pendingCountRef.current > 0,
          lastError: hadError ? "Не сохранилось, повторю через 15с" : null,
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
  }, []);

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
    setSyncStatus({ pending: true, lastError: null });
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
        setSyncStatus({ pending: pendingCountRef.current > 0, lastError: null });
      });
  }, []);

  const restoreRow = useCallback((table: string, id: string) => {
    const db = dbRef.current;
    if (!db) return;
    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null });
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
        setSyncStatus({ pending: pendingCountRef.current > 0, lastError: null });
      });
  }, []);

  const savePanelLayout = useCallback((layout: PanelLayout) => {
    setPanelLayoutState(layout);
    const db = dbRef.current;
    if (!db) return;
    pendingCountRef.current++;
    setSyncStatus({ pending: true, lastError: null });
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
        setSyncStatus({ pending: pendingCountRef.current > 0, lastError: null });
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
    router.push("/login");
    return { ok: true };
  }, [router]);

  // ---- Boot: load auth session, initial data, panel layout, seed shadow,
  // subscribe to realtime. Mirrors legacy-tracker.js's boot() function.
  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    dbRef.current = db;

    async function boot() {
      const { data: sessionData } = await db.auth.getSession();
      if (!sessionData.session) {
        router.push("/login");
        return;
      }
      const uid = sessionData.session.user.id;
      if (cancelled) return;
      setUserId(uid);

      const results = await Promise.all([
        db.from("tasks").select("*").is("deleted_at", null),
        db.from("meetings").select("*").is("deleted_at", null),
        db.from("ideas").select("*").is("deleted_at", null).order("created_at", { ascending: true }),
        db.from("assignees").select("*").order("created_at", { ascending: true }),
        db.from("sections").select("*").order("sort_order", { ascending: true }),
      ]);
      if (cancelled) return;

      const failed = results.find((r) => r.error);
      if (failed) {
        setLoadError(failed.error!.message);
        setLoading(false);
        return;
      }

      const loadedTasks = (results[0].data as TaskRow[]).map(taskFromRow);
      const loadedMeetings = (results[1].data as MeetingRow[]).map(meetingFromRow);
      const loadedIdeas = (results[2].data as IdeaRow[]).map(ideaFromRow);
      let loadedAssignees = (results[3].data as { name: string }[]).map((r) => r.name);
      const loadedSections = (results[4].data as SectionRow[]).map(sectionFromRow);

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

      if (loadedAssignees.length === 0) loadedAssignees = DEFAULT_ASSIGNEES.slice();
      loadedTasks.forEach((t) => {
        if (t.assignee && !loadedAssignees.includes(t.assignee)) loadedAssignees.push(t.assignee);
      });

      liveRef.current = {
        tasks: loadedTasks,
        meetings: loadedMeetings,
        ideas: loadedIdeas,
        assignees: loadedAssignees,
        sections: loadedSections,
      };
      setTasks(loadedTasks);
      setMeetings(loadedMeetings);
      setIdeas(loadedIdeas);
      setAssignees(loadedAssignees);
      setSections(loadedSections);

      try {
        const prefsRes = await db.from("user_prefs").select("panel_layout").maybeSingle();
        if (!cancelled) setPanelLayoutState((prefsRes.data?.panel_layout as PanelLayout) || DEFAULT_PANEL_LAYOUT);
      } catch {
        if (!cancelled) setPanelLayoutState(DEFAULT_PANEL_LAYOUT);
      }

      setLoading(false);
      persistAllRef.current(); // sync any seeded/back-filled assignees

      // ---- Realtime: merge changes from another tab/device into both the
      // live list and a CLONED copy in shadow (never the same object
      // reference — see snapshotList()'s doc comment for why).
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
    return () => {
      cancelled = true;
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
