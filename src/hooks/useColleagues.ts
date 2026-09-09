"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";

// Who on the team is reachable in a messenger.
//
// The tracker's own assignee list is plain names (that is all a task needs);
// the connection to a chat lives on the same row in the database and is only
// interesting in two places: the team screen, and the "send" buttons, which
// have to know whether there is anywhere to send to. So it is loaded here
// rather than threaded through the whole app.
//
// A person can be connected to Telegram, to MAX, or to both; `linked` means
// "reachable at all", which is what the send buttons care about.

export type ColleagueChannel = "telegram" | "max";

// Whether this person also has a LOGIN, which is a different question from
// whether a bot can write to him: a manager may live entirely in Telegram,
// entirely in the tracker, or in both.
export type MemberState = "none" | "invited" | "active" | "disabled";

export type Colleague = {
  id: string;
  name: string;
  linked: boolean;
  telegram: boolean;
  max: boolean;
  username: string | null;
  member: MemberState;
};

// Set only when a MAX bot exists for this install — creating one needs a
// verified organisation profile on MAX для партнёров, so many installs will
// never have it, and offering an invite that cannot work is worse than not
// offering one.
export const MAX_BOT_USERNAME = process.env.NEXT_PUBLIC_MAX_BOT_USERNAME || "";
export const MAX_AVAILABLE = !!MAX_BOT_USERNAME;

async function fetchColleagues(): Promise<Colleague[] | null> {
  const db = createClient();
  const { data, error } = await db
    .from("assignees")
    .select("id, name, telegram_chat_id, telegram_username, max_user_id, max_username")
    .order("created_at");
  if (error || !data) return null;

  // Read separately and forgivingly: this table arrives with migration 0019,
  // and a deployment that is ahead of its database must still show the team
  // screen rather than an empty one. An error here means "nobody has a login
  // yet", which is the truth in that situation anyway.
  const { data: members } = await db.from("workspace_members").select("assignee_id, status");
  const memberOf = new Map<string, MemberState>();
  for (const row of members || []) {
    memberOf.set(row.assignee_id as string, (row.status as MemberState) || "none");
  }

  // The owner's own row is dropped here rather than in the team screen: a
  // bot cannot write to the person running it, so «пригласить самого себя»
  // is an offer that could never work, wherever it appeared.
  return data
    .filter((r) => !isSelfAssignee((r.name as string) || ""))
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      telegram: r.telegram_chat_id != null,
      max: r.max_user_id != null,
      linked: r.telegram_chat_id != null || r.max_user_id != null,
      username: ((r.telegram_username || r.max_username) as string) || null,
      member: memberOf.get(r.id as string) || "none",
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
  const invite = useCallback(
    async (assigneeId: string, channel: ColleagueChannel): Promise<{ link: string; code: string } | { error: string }> => {
      const res = await fetch("/api/telegram/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId, channel }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось создать приглашение" };
      return { link: data.link as string, code: data.code as string };
    },
    [],
  );

  // The other kind of invitation: a login rather than a chat. Returns the
  // link to hand over — the same shape as `invite` above, so the team screen
  // treats the two the same way.
  const inviteToTracker = useCallback(
    async (assigneeId: string): Promise<{ link: string; code: string } | { error: string }> => {
      const res = await fetch("/api/workspace/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось создать приглашение" };
      await reload();
      return { link: data.link as string, code: data.code as string };
    },
    [reload],
  );

  // Увольнение (A4): доступ выключается, данные остаются на месте. Строка
  // участия в задачах никуда не девается — иначе вместе с человеком из
  // трекера исчезло бы и то, что он делал, и задачи стали бы ничьими
  // задним числом.
  const setTrackerAccess = useCallback(
    async (assigneeId: string, active: boolean) => {
      const db = createClient();
      await db
        .from("workspace_members")
        .update(
          active
            ? { status: "active", disabled_at: null }
            : { status: "disabled", disabled_at: new Date().toISOString() },
        )
        .eq("assignee_id", assigneeId);
      await reload();
    },
    [reload],
  );

  const unlink = useCallback(
    async (assigneeId: string, channel: ColleagueChannel) => {
      const db = createClient();
      const patch =
        channel === "max"
          ? { max_user_id: null, max_username: null, max_linked_at: null }
          : { telegram_chat_id: null, telegram_username: null, linked_at: null };
      await db.from("assignees").update(patch).eq("id", assigneeId);
      await reload();
    },
    [reload],
  );

  return { colleagues, loading, reload, invite, inviteToTracker, setTrackerAccess, unlink };
}

export type SendResult = { sentTo: string[]; failed: string[] } | { error: string };

// Sending is by id: the server reads the item back itself, so nothing about
// what gets written to a colleague comes from the browser. Which messenger
// it travels through is decided there too, from how the person is connected.
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
