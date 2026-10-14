"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { coalescer } from "@/lib/coalesce";
import { onRevive } from "@/lib/revive";

// Голоса опроса времени встречи (миграция 0062). Только чтение: пишет
// маршрут /api/workspace/slot-vote (после каждого голоса он решает, не пора
// ли назначать). Подписка — чтобы отметки коллег появлялись сразу.
export type SlotVote = { assigneeId: string; slots: number[] };

export function useSlotVotes(meetingId: string, enabled: boolean): { votes: SlotVote[]; reload: () => void } {
  const [votes, setVotes] = useState<SlotVote[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !meetingId) return;
    let cancelled = false;
    const reader = coalescer(async () => {
      const { data, error } = await createClient().from("meeting_slot_votes").select("assignee_id, slots").eq("meeting_id", meetingId);
      if (cancelled || error) return;
      setVotes(((data || []) as { assignee_id: string; slots: number[] }[]).map((r) => ({ assigneeId: r.assignee_id, slots: r.slots || [] })));
    });
    void reader.now();
    const db = createClient();
    const channel = db
      .channel("slot-votes:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_slot_votes", filter: `meeting_id=eq.${meetingId}` }, reader.soon)
      .subscribe();
    const stopRevive = onRevive(reader.soon);
    return () => {
      cancelled = true;
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [meetingId, enabled, tick]);
  return { votes, reload: () => setTick((n) => n + 1) };
}
