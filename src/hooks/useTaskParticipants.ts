"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskParticipant, TaskParticipantRole } from "@/lib/taskProgress";

// Кто на задаче: исполнители, соисполнители, наблюдатели.
//
// Deliberately NOT part of useTrackerData. That hook is an optimistic
// diff-and-sync engine: local state is the truth while you type, and a
// deep-cloned "shadow" of what the database confirmed is what the diff runs
// against. Threading a second, differently-shaped table through it is how
// that machinery breaks — and it broke once already, expensively (see the
// sync rule in CLAUDE.md).
//
// Participation does not need any of that. It changes by pressing a button,
// not by typing; there is nothing to debounce and nothing to merge. So it is
// written straight through and read back, with realtime keeping the screen
// honest when somebody answers from Telegram.

export type Participant = TaskParticipant & { id: string };

type Row = {
  id: string;
  task_id: string;
  assignee_id: string;
  role: TaskParticipantRole;
  accepted_at: string | null;
  done_at: string | null;
  done_comment: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  reschedule_requested_at: string | null;
  reschedule_to: string | null;
  reschedule_reason: string | null;
  assignees: { name: string } | { name: string }[] | null;
};

function nameOf(row: Row): string {
  const a = row.assignees;
  if (!a) return "";
  return Array.isArray(a) ? a[0]?.name || "" : a.name || "";
}

export type PersonOption = { id: string; name: string };

export function useTaskParticipants() {
  const [byTask, setByTask] = useState<Record<string, Participant[]>>({});
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetching and applying are split on purpose: the React compiler lint
  // refuses a function that sets state being called straight from an effect
  // body, and it is right to — the state has to land in the promise
  // callback, where the "was this unmounted" guard lives. Same shape as
  // useColleagues, for the same reason.
  const fetchAll = useCallback(async (): Promise<{ grouped: Record<string, Participant[]>; people: PersonOption[] }> => {
    const db = createClient();
    const [{ data: rows }, { data: assignees }] = await Promise.all([
      db
        .from("task_participants")
        .select(
          "id, task_id, assignee_id, role, accepted_at, done_at, done_comment, declined_at, decline_reason, reschedule_requested_at, reschedule_to, reschedule_reason, assignees(name)",
        ),
      // The full list, the owner's own row included: work can be put on
      // yourself, and the send menu is the only place that has a reason to
      // leave you out of it.
      db.from("assignees").select("id, name").order("name"),
    ]);

    const grouped: Record<string, Participant[]> = {};
    for (const raw of (rows || []) as Row[]) {
      const p: Participant = {
        id: raw.id,
        assigneeId: raw.assignee_id,
        name: nameOf(raw),
        role: raw.role,
        acceptedAt: raw.accepted_at,
        doneAt: raw.done_at,
        doneComment: raw.done_comment,
        declinedAt: raw.declined_at,
        declineReason: raw.decline_reason,
      };
      (grouped[raw.task_id] ||= []).push(p);
    }
    return { grouped, people: ((assignees || []) as PersonOption[]).map((a) => ({ id: a.id, name: a.name })) };
  }, []);

  const load = useCallback(async () => {
    const { grouped, people: list } = await fetchAll();
    setByTask(grouped);
    setPeople(list);
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(({ grouped, people: list }) => {
      if (cancelled) return;
      setByTask(grouped);
      setPeople(list);
      setLoading(false);
    });

    // Somebody pressing «Сделал» in Telegram has to move the card here
    // without a reload — the same reason every other table the UI watches is
    // in the realtime publication.
    const db = createClient();
    const channel = db
      .channel("task-participants")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_participants" }, () => {
        fetchAll().then(({ grouped, people: list }) => {
          if (cancelled) return;
          setByTask(grouped);
          setPeople(list);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [fetchAll]);

  const add = useCallback(
    async (taskId: string, assigneeId: string, role: TaskParticipantRole) => {
      const db = createClient();
      // user_id is filled by a trigger from the parent task — never from
      // here, so a row cannot land in the wrong workspace (migration 0019).
      await db.from("task_participants").insert({ task_id: taskId, assignee_id: assigneeId, role });
      await load();
    },
    [load],
  );

  const setRole = useCallback(
    async (participantId: string, role: TaskParticipantRole) => {
      const db = createClient();
      await db.from("task_participants").update({ role }).eq("id", participantId);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (participantId: string) => {
      const db = createClient();
      await db.from("task_participants").delete().eq("id", participantId);
      await load();
    },
    [load],
  );

  // ---- Приёмка ------------------------------------------------------
  //
  // These write ONLY columns the sync engine does not own (see taskToRow:
  // it lists the columns it writes, and none of these are in it). Marking
  // the task done is not done here for exactly that reason — `status` IS a
  // synced column, and writing it behind the local state's back is how an
  // open tab silently reverts it. The caller flips the status through the
  // ordinary path and passes nothing back.

  const approve = useCallback(
    async (taskId: string, comment: string) => {
      const db = createClient();
      await db
        .from("tasks")
        .update({ approval_state: "accepted", approval_comment: comment || null, approved_at: new Date().toISOString() })
        .eq("id", taskId);
    },
    [],
  );

  // Возврат на доработку: работа исполнителей обнуляется, иначе задача
  // остаётся «все отчитались» и приёмка тут же предложится снова.
  const returnForRework = useCallback(
    async (taskId: string, comment: string) => {
      const db = createClient();
      await db
        .from("tasks")
        .update({ approval_state: "returned", approval_comment: comment || null, approved_at: null })
        .eq("id", taskId);
      await db
        .from("task_participants")
        .update({ done_at: null, done_comment: null })
        .eq("task_id", taskId)
        .eq("role", "executor");
      await load();
    },
    [load],
  );

  // B2: закрыть волевым решением. The fact that it was forced is the part
  // that must survive, so it is its own column rather than a status.
  const forceClose = useCallback(
    async (taskId: string, reason: string) => {
      const db = createClient();
      const { data } = await db.auth.getUser();
      await db
        .from("tasks")
        .update({
          approval_state: "accepted",
          approved_at: new Date().toISOString(),
          force_closed_by: data?.user?.id || null,
          force_closed_reason: reason || null,
        })
        .eq("id", taskId);
    },
    [],
  );

  const forTask = useCallback((taskId: string) => byTask[taskId] || [], [byTask]);

  // Only the people not already on the task — offering to add somebody
  // twice produces a constraint error rather than a second row.
  const availableFor = useCallback(
    (taskId: string) => {
      const taken = new Set((byTask[taskId] || []).map((p) => p.assigneeId));
      return people.filter((p) => !taken.has(p.id));
    },
    [byTask, people],
  );

  return useMemo(
    () => ({ loading, people, forTask, availableFor, add, setRole, remove, approve, returnForRework, forceClose, reload: load }),
    [loading, people, forTask, availableFor, add, setRole, remove, approve, returnForRework, forceClose, load],
  );
}
