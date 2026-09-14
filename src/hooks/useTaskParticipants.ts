"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";
import { assignPerson, waitForTaskRow } from "@/lib/assignWork";
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

export type Participant = TaskParticipant & {
  id: string;
  // Просьба о переносе: исполнитель может только попросить (B6), и до сих
  // пор просьба уходила в базу и не показывалась никому — то есть
  // человек просил в пустоту.
  rescheduleTo: string | null;
  rescheduleReason: string | null;
};

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

// Кого поставили на задачу ДО того, как она появилась в базе: выбор,
// сделанный в окне создания и ждущий своей строки (см. attachOnCreate).
export type PendingParticipant = { assigneeId: string; name: string; role: TaskParticipantRole };

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
        rescheduleTo: raw.reschedule_to,
        rescheduleReason: raw.reschedule_reason,
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
    async (taskId: string, assigneeId: string, role: TaskParticipantRole): Promise<string> => {
      const person = people.find((p) => p.id === assigneeId);
      const notice = await assignPerson(taskId, assigneeId, person?.name || "", role);
      await load();
      return notice;
    },
    [load, people],
  );

  // Всё, что выбрали в окне создания, — одной операцией, когда задача
  // доехала до базы.
  //
  // Поле «Исполнитель» и список участников — не два разных механизма, а
  // короткая и полная запись одного и того же. Поэтому сохранение задачи с
  // исполнителем заводит ему строку само: иначе человек, привыкший к полю,
  // получил бы задачу без единого участника и без единого отчёта, а список
  // выглядел бы необязательной добавкой, которую можно не заполнять.
  const attachOnCreate = useCallback(
    async (taskId: string, assigneeName: string, extra: PendingParticipant[] = []) => {
      const wanted: { id: string; role: TaskParticipantRole }[] = [];

      const clean = (assigneeName || "").trim();
      if (clean && !isSelfAssignee(clean)) {
        const primary = people.find((p) => p.name === clean);
        if (primary) wanted.push({ id: primary.id, role: "executor" });
      }
      for (const person of extra) {
        if (!wanted.some((w) => w.id === person.assigneeId)) wanted.push({ id: person.assigneeId, role: person.role });
      }

      const already = new Set((byTask[taskId] || []).map((p) => p.assigneeId));
      const todo = wanted.filter((w) => !already.has(w.id));
      if (!todo.length) return;

      // Не дождались (нет связи, задача не ушла в облако) — молча выходим:
      // участников можно добавить руками, а падать здесь незачем.
      if (!(await waitForTaskRow(taskId))) return;

      // По одному, а не пачкой: каждая вставка ещё и пишет человеку в
      // мессенджер, и «назначена» — то, о чём узнают порознь.
      for (const w of todo) await add(taskId, w.id, w.role);
    },
    [people, byTask, add],
  );

  const setRole = useCallback(
    async (participantId: string, role: TaskParticipantRole) => {
      const db = createClient();
      await db.from("task_participants").update({ role }).eq("id", participantId);
      await load();
    },
    [load],
  );

  // Просьбу либо удовлетворяют, либо отклоняют — в обоих случаях она
  // перестаёт висеть. Сам срок меняет вызывающий: колонка deadline
  // принадлежит движку синхронизации, и писать её отсюда нельзя.
  const clearRescheduleRequest = useCallback(
    async (participantId: string) => {
      const db = createClient();
      await db
        .from("task_participants")
        .update({ reschedule_requested_at: null, reschedule_to: null, reschedule_reason: null })
        .eq("id", participantId);
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

  // Решение постановщика уходит на сервер по той же причине, по которой
  // туда ушли ответы исполнителя: правила должны жить в одном месте, и
  // сказать людям о возврате может только тот, у кого есть доступ к боту.
  const review = useCallback(
    async (action: "approve" | "return" | "force", taskId: string, comment: string) => {
      const res = await fetch("/api/workspace/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, taskId, comment }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || "Не получилось");
      await load();
    },
    [load],
  );

  const approve = useCallback((taskId: string, comment: string) => review("approve", taskId, comment), [review]);
  const returnForRework = useCallback((taskId: string, comment: string) => review("return", taskId, comment), [review]);
  const forceClose = useCallback((taskId: string, reason: string) => review("force", taskId, reason), [review]);

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
    () => ({ loading, people, forTask, availableFor, add, attachOnCreate, setRole, remove, clearRescheduleRequest, approve, returnForRework, forceClose, reload: load }),
    [loading, people, forTask, availableFor, add, attachOnCreate, setRole, remove, clearRescheduleRequest, approve, returnForRework, forceClose, load],
  );
}
