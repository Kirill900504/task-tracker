"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import { uid } from "@/lib/uid";

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

export type AssignedMeeting = {
  participantId: string;
  meetingId: string;
  title: string;
  date: string;
  time: string;
  response: "none" | "yes" | "no";
  reason: string | null;
  // Круг голосования строки и текущий круг встречи: ответ из прежнего
  // круга ничего не говорит о новом времени и считается неотвеченным.
  round: number;
  meetingRound: number;
};

export type AssignedIdea = {
  recipientId: string;
  ideaId: string;
  text: string;
  seenAt: string | null;
  convertedTaskId: string | null;
};

export function useAssignedWork(assigneeId: string) {
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [meetings, setMeetings] = useState<AssignedMeeting[]>([]);
  const [ideas, setIdeas] = useState<AssignedIdea[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (): Promise<{ tasks: AssignedTask[]; meetings: AssignedMeeting[]; ideas: AssignedIdea[] }> => {
    if (!assigneeId) return { tasks: [], meetings: [], ideas: [] };
    const db = createClient();
    const today = new Date().toISOString().slice(0, 10);
    const [{ data }, { data: meetingRows }, { data: ideaRows }] = await Promise.all([
      db
        .from("task_participants")
        .select(
          "id, task_id, role, accepted_at, done_at, done_comment, declined_at, decline_reason, reschedule_to, reschedule_reason, " +
            "tasks(title, description, deadline, priority, status, approval_state, approval_comment, deleted_at)",
        )
        .eq("assignee_id", assigneeId),
      // Прошедшие встречи руководителю не нужны: голосовать по ним поздно,
      // а список тем длиннее.
      db
        .from("meeting_participants")
        .select("id, meeting_id, response, reason, round, meetings(title, date, time, status, vote_round, deleted_at)")
        .eq("assignee_id", assigneeId),
      db
        .from("idea_recipients")
        .select("id, idea_id, seen_at, converted_task_id, ideas(text, deleted_at)")
        .eq("assignee_id", assigneeId),
    ]);

    type MRow = {
      id: string;
      meeting_id: string;
      response: "none" | "yes" | "no";
      reason: string | null;
      round: number;
      meetings: { title: string; date: string; time: string | null; status: string; vote_round: number | null; deleted_at: string | null } | null;
    };

    const meetings = ((meetingRows as unknown as MRow[]) || [])
      .filter((r) => r.meetings && !r.meetings.deleted_at && r.meetings.status === "planned" && r.meetings.date >= today)
      .map((r) => ({
        participantId: r.id,
        meetingId: r.meeting_id,
        title: r.meetings!.title,
        date: r.meetings!.date,
        time: r.meetings!.time || "",
        response: r.response,
        reason: r.reason,
        round: r.round,
        meetingRound: Number(r.meetings!.vote_round ?? 1) || 1,
      }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    type IRow = {
      id: string;
      idea_id: string;
      seen_at: string | null;
      converted_task_id: string | null;
      ideas: { text: string; deleted_at: string | null } | null;
    };

    // Мысль, уже взятую в работу, показывать незачем: она стала задачей и
    // живёт выше, среди задач.
    const ideas = ((ideaRows as unknown as IRow[]) || [])
      .filter((r) => r.ideas && !r.ideas.deleted_at && !r.converted_task_id)
      .map((r) => ({
        recipientId: r.id,
        ideaId: r.idea_id,
        text: r.ideas!.text,
        seenAt: r.seen_at,
        convertedTaskId: r.converted_task_id,
      }));

    return { tasks: shape((data as unknown as Row[]) || []), meetings, ideas };
  }, [assigneeId]);

  const reload = useCallback(async () => {
    const { tasks: t, meetings: m, ideas: i } = await fetchAll();
    setTasks(t);
    setMeetings(m);
    setIdeas(i);
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(({ tasks: t, meetings: m, ideas: i }) => {
      if (cancelled) return;
      setTasks(t);
      setMeetings(m);
      setIdeas(i);
      setLoading(false);
    });

    // Задачу могли поставить, поменять срок или вернуть на доработку прямо
    // сейчас — экран должен это показать без перезагрузки.
    const db = createClient();
    const channel = db
      .channel("assigned-work")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_participants" }, () => {
        void reload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        void reload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_participants" }, () => {
        void reload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "idea_recipients" }, () => {
        void reload();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [fetchAll, reload]);

  // Все ответы идут через один серверный маршрут: он проверяет, что
  // строка действительно твоя, применяет правила (комментарий обязателен,
  // причина обязательна), переводит задачу на приёмку, когда отчитались
  // все, и пишет владельцу. Писать это же из браузера значило бы иметь
  // две реализации одного действия — и они разошлись бы за неделю.
  const answer = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/workspace/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || "Не получилось отправить ответ");
      await reload();
    },
    [reload],
  );

  const accept = useCallback(
    (participantId: string) => answer({ action: "accept", participantId }),
    [answer],
  );

  const report = useCallback(
    (participantId: string, comment: string) => answer({ action: "done", participantId, comment }),
    [answer],
  );

  const decline = useCallback(
    (participantId: string, reason: string) => answer({ action: "decline", participantId, comment: reason }),
    [answer],
  );

  const askReschedule = useCallback(
    (participantId: string, to: string, reason: string) =>
      answer({ action: "reschedule", participantId, date: to || null, comment: reason }),
    [answer],
  );

  const vote = useCallback(
    (participantId: string, response: "yes" | "no", reason: string) =>
      answer({ action: "vote", participantId, response, comment: reason }),
    [answer],
  );

  // «Взять в работу»: мысль становится задачей на этого же человека, без
  // срока — срок ставит тот, кто спросит, а не тот, кто взялся. Задача
  // сразу принята: нажатие и есть согласие.
  const takeIdea = useCallback(
    async (recipientId: string, ideaId: string, text: string, ownerId: string) => {
      const db = createClient();
      const { data: me } = await db.auth.getUser();
      const taskId = uid();
      const title = text.trim().slice(0, 200) || "Из мысли";
      const { error } = await db.from("tasks").insert({
        id: taskId,
        user_id: ownerId,
        title,
        assignee: "",
        created_by: me?.user?.id || null,
      });
      if (error) throw new Error(error.message);
      await db.from("task_participants").insert({
        task_id: taskId,
        assignee_id: assigneeId,
        role: "executor",
        accepted_at: new Date().toISOString(),
      });
      await db
        .from("idea_recipients")
        .update({ converted_task_id: taskId, seen_at: new Date().toISOString() })
        .eq("id", recipientId);
      await reload();
    },
    [assigneeId, reload],
  );

  return { tasks, meetings, ideas, loading, accept, report, decline, askReschedule, vote, takeIdea, reload };
}
