"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskParticipantRole } from "@/lib/taskProgress";

// Что назначено лично мне — глазами руководителя, а не владельца.
//
// The owner's tracker loads everything and runs an optimistic sync engine
// over it. A manager needs neither: he sees the handful of items he is
// actually on, and the only thing he writes is his own answer about
// himself. So this reads exactly that and writes exactly that — which is
// also all the database will let him do (see the report-self policy in
// migration 0019).

export type AssignedTask = {
  participantId: string;
  taskId: string;
  title: string;
  description: string;
  deadline: string;
  priority: string;
  status: string;
  role: TaskParticipantRole;
  acceptedAt: string | null;
  doneAt: string | null;
  doneComment: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  rescheduleTo: string | null;
  rescheduleReason: string | null;
  approvalState: string;
  approvalComment: string;
};

type Row = {
  id: string;
  task_id: string;
  role: TaskParticipantRole;
  accepted_at: string | null;
  done_at: string | null;
  done_comment: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  reschedule_to: string | null;
  reschedule_reason: string | null;
  tasks: {
    title: string;
    description: string | null;
    deadline: string | null;
    priority: string | null;
    status: string | null;
    approval_state: string | null;
    approval_comment: string | null;
    deleted_at: string | null;
  } | null;
};

function shape(rows: Row[]): AssignedTask[] {
  return rows
    .filter((r) => r.tasks && !r.tasks.deleted_at)
    .map((r) => ({
      participantId: r.id,
      taskId: r.task_id,
      title: r.tasks!.title,
      description: r.tasks!.description || "",
      deadline: r.tasks!.deadline || "",
      priority: r.tasks!.priority || "med",
      status: r.tasks!.status || "in_progress",
      role: r.role,
      acceptedAt: r.accepted_at,
      doneAt: r.done_at,
      doneComment: r.done_comment,
      declinedAt: r.declined_at,
      declineReason: r.decline_reason,
      rescheduleTo: r.reschedule_to,
      rescheduleReason: r.reschedule_reason,
      approvalState: r.tasks!.approval_state || "open",
      approvalComment: r.tasks!.approval_comment || "",
    }));
}

export function useAssignedWork(assigneeId: string) {
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (): Promise<AssignedTask[]> => {
    if (!assigneeId) return [];
    const db = createClient();
    const { data } = await db
      .from("task_participants")
      .select(
        "id, task_id, role, accepted_at, done_at, done_comment, declined_at, decline_reason, reschedule_to, reschedule_reason, " +
          "tasks(title, description, deadline, priority, status, approval_state, approval_comment, deleted_at)",
      )
      .eq("assignee_id", assigneeId);
    return shape((data as unknown as Row[]) || []);
  }, [assigneeId]);

  const reload = useCallback(async () => {
    setTasks(await fetchAll());
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((list) => {
      if (cancelled) return;
      setTasks(list);
      setLoading(false);
    });

    // Задачу могли поставить, поменять срок или вернуть на доработку прямо
    // сейчас — экран должен это показать без перезагрузки.
    const db = createClient();
    const channel = db
      .channel("assigned-work")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_participants" }, () => {
        fetchAll().then((list) => {
          if (!cancelled) setTasks(list);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        fetchAll().then((list) => {
          if (!cancelled) setTasks(list);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [fetchAll]);

  const accept = useCallback(
    async (participantId: string) => {
      const db = createClient();
      await db.from("task_participants").update({ accepted_at: new Date().toISOString() }).eq("id", participantId);
      await reload();
    },
    [reload],
  );

  // Отчёт без слов отчётом не является (B5) — поэтому комментарий приходит
  // вместе с отметкой, а не «когда-нибудь потом».
  const report = useCallback(
    async (participantId: string, comment: string) => {
      const db = createClient();
      await db
        .from("task_participants")
        .update({ done_at: new Date().toISOString(), done_comment: comment, declined_at: null, decline_reason: null })
        .eq("id", participantId);
      await reload();
    },
    [reload],
  );

  const decline = useCallback(
    async (participantId: string, reason: string) => {
      const db = createClient();
      await db
        .from("task_participants")
        .update({ declined_at: new Date().toISOString(), decline_reason: reason, done_at: null, done_comment: null })
        .eq("id", participantId);
      await reload();
    },
    [reload],
  );

  // B6: срок двигает постановщик. Отсюда можно только попросить — и это
  // закрыто не вежливостью интерфейса, а правами доступа к таблице задач.
  const askReschedule = useCallback(
    async (participantId: string, to: string, reason: string) => {
      const db = createClient();
      await db
        .from("task_participants")
        .update({ reschedule_requested_at: new Date().toISOString(), reschedule_to: to || null, reschedule_reason: reason })
        .eq("id", participantId);
      await reload();
    },
    [reload],
  );

  return { tasks, loading, accept, report, decline, askReschedule, reload };
}
