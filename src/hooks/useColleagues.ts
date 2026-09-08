"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";

// Who on the team is reachable in Telegram.
//
// The tracker's own assignee list is plain names (that is all a task needs);
// the connection to a chat lives on the same row in the database and is only
// interesting in two places: the team screen, and the "send" buttons, which
// have to know whether there is anywhere to send to. So it is loaded here
// rather than threaded through the whole app.

export type Colleague = {
  id: string;
  name: string;
  linked: boolean;
  username: string | null;
};

async function fetchColleagues(): Promise<Colleague[] | null> {
  const db = createClient();
  const { data, error } = await db.from("assignees").select("id, name, telegram_chat_id, telegram_username").order("created_at");
  if (error || !data) return null;
  // The owner's own row is dropped here rather than in the team screen: a
  // bot cannot write to the person running it, so «пригласить самого себя»
  // is an offer that could never work, wherever it appeared.
  return data
    .filter((r) => !isSelfAssignee((r.name as string) || ""))
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      linked: r.telegram_chat_id != null,
      username: (r.telegram_username as string) || null,
    }));
}

export function useColleagues() {
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await fetchColleagues();
    if (rows) setColleagues(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchColleagues().then((rows) => {
      if (cancelled) return;
      if (rows) setColleagues(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Returns the invite link to hand to the person — the code inside it is
  // what attaches their chat to this name when they press Start.
  const invite = useCallback(async (assigneeId: string): Promise<{ link: string; code: string } | { error: string }> => {
    const res = await fetch("/api/telegram/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось создать приглашение" };
    return { link: data.link as string, code: data.code as string };
  }, []);

  const unlink = useCallback(
    async (assigneeId: string) => {
      const db = createClient();
      await db.from("assignees").update({ telegram_chat_id: null, telegram_username: null, linked_at: null }).eq("id", assigneeId);
      await reload();
    },
    [reload],
  );

  return { colleagues, loading, reload, invite, unlink };
}

export type SendResult = { sentTo: string[]; failed: string[] } | { error: string };

// Sending is by id: the server reads the item back itself, so nothing about
// what gets written to a colleague comes from the browser.
export async function sendToTelegram(kind: "task" | "meeting" | "idea", id: string, to?: string[]): Promise<SendResult> {
  const res = await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id, ...(to ? { to } : {}) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось отправить" };
  return { sentTo: data.sentTo || [], failed: data.failed || [] };
}
