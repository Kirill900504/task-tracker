"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";
import type { MeetingVote } from "@/lib/meetingVotes";

// Кто придёт, кто не сможет и кто не ответил.
//
// The meeting keeps its list of participants as names, exactly as it always
// has — that list is what the chips edit, what the bot addresses and what
// every existing screen reads. What is added underneath is one row per
// person to hold their answer, because `confirmed_by` (a list of people who
// pressed «Буду») cannot express the two things that matter most: a refusal
// with a reason, and the difference between "не придёт" and "не ответил".
//
// The rows are kept in step with the names rather than edited separately:
// two lists of the same people, maintained by hand, drift apart within a
// week.

export type MeetingVoteRow = MeetingVote & { id: string; meetingId: string };

type Row = {
  id: string;
  meeting_id: string;
  assignee_id: string;
  role: "organizer" | "participant" | "watcher";
  response: "none" | "yes" | "no";
  reason: string | null;
  round: number;
  assignees: { name: string } | { name: string }[] | null;
};

function nameOf(row: Row): string {
  const a = row.assignees;
  if (!a) return "";
  return Array.isArray(a) ? a[0]?.name || "" : a.name || "";
}

export function useMeetingVotes() {
  const [byMeeting, setByMeeting] = useState<Record<string, MeetingVoteRow[]>>({});
  const [peopleByName, setPeopleByName] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async () => {
    const db = createClient();
    const [{ data: rows }, { data: assignees }] = await Promise.all([
      db.from("meeting_participants").select("id, meeting_id, assignee_id, role, response, reason, round, assignees(name)"),
      db.from("assignees").select("id, name"),
    ]);

    const grouped: Record<string, MeetingVoteRow[]> = {};
    for (const raw of (rows || []) as Row[]) {
      (grouped[raw.meeting_id] ||= []).push({
        id: raw.id,
        meetingId: raw.meeting_id,
        assigneeId: raw.assignee_id,
        name: nameOf(raw),
        role: raw.role,
        response: raw.response,
        reason: raw.reason,
        round: raw.round,
      });
    }
    const names: Record<string, string> = {};
    for (const a of ((assignees || []) as { id: string; name: string }[])) names[a.name] = a.id;
    return { grouped, names };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apply = ({ grouped, names }: { grouped: Record<string, MeetingVoteRow[]>; names: Record<string, string> }) => {
      if (cancelled) return;
      setByMeeting(grouped);
      setPeopleByName(names);
    };
    fetchAll().then(apply);

    const db = createClient();
    const channel = db
      .channel("meeting-votes")
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_participants" }, () => {
        fetchAll().then(apply);
      })
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [fetchAll]);

  const reload = useCallback(async () => {
    const { grouped, names } = await fetchAll();
    setByMeeting(grouped);
    setPeopleByName(names);
  }, [fetchAll]);

  // Привести строки голосования в соответствие со списком участников.
  // Вызывается после сохранения встречи: список имён — источник правды,
  // строки — то, что под ним.
  const sync = useCallback(
    async (meetingId: string, names: string[]) => {
      const db = createClient();
      const wanted = names.filter((n) => n && !isSelfAssignee(n));
      const existing = byMeeting[meetingId] || [];

      const wantedIds = new Set(wanted.map((n) => peopleByName[n]).filter(Boolean));
      const haveIds = new Set(existing.map((r) => r.assigneeId));

      const toAdd = [...wantedIds].filter((id) => !haveIds.has(id));
      const toDrop = existing.filter((r) => !wantedIds.has(r.assigneeId));

      if (toAdd.length) {
        // Только что созданная встреча ещё не в базе — локальное состояние
        // истина, запись в облако идёт своим ходом. Строка голосования,
        // вставленная раньше, сослалась бы на несуществующую встречу и
        // пропала бы без единой ошибки на экране.
        let exists = false;
        for (let attempt = 0; attempt < 12 && !exists; attempt++) {
          const { data } = await db.from("meetings").select("id").eq("id", meetingId).maybeSingle();
          if (data) exists = true;
          else await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (exists) {
          await db.from("meeting_participants").insert(
            toAdd.map((assignee_id) => ({ meeting_id: meetingId, assignee_id, role: "participant" as const })),
          );
        }
      }
      for (const row of toDrop) await db.from("meeting_participants").delete().eq("id", row.id);
      if (toAdd.length || toDrop.length) await reload();
    },
    [byMeeting, peopleByName, reload],
  );

  // C3: перенос обнуляет голосование. Ответ про вторник ничего не говорит
  // про четверг, поэтому раунд растёт, а прежние ответы остаются позади —
  // их не стирают, они просто перестают считаться подтверждением.
  const bumpRound = useCallback(async (meetingId: string, currentRound: number) => {
    const db = createClient();
    await db.from("meetings").update({ vote_round: currentRound + 1 }).eq("id", meetingId);
  }, []);

  const forMeeting = useCallback((meetingId: string) => byMeeting[meetingId] || [], [byMeeting]);

  return { forMeeting, sync, bumpRound, reload };
}
