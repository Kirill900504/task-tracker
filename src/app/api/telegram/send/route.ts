import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { ideaButtons, ideaMessage, meetingButtons, meetingMessage, taskButtons, taskMessage, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { chatsForPerson } from "@/lib/reach";
import { actorName } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import type { BotChannelConfig } from "@/lib/botTransport";

// Sending a task, a meeting or a thought to the colleague it concerns.
//
// What is sent is read back from the database through the USER's own client,
// so RLS decides what may be sent at all — the request carries an id, never
// the content, and cannot be used to push arbitrary text through the bot.
// Who it goes to is worked out here too: the task's assignee, the meeting's
// participants, or, for a thought, the named person.
//
// Which messenger it travels through is not the caller's business either:
// a colleague is connected to Telegram, to MAX, or to both, and one message
// goes to whichever they connected first (see chatsFor).

type Recipient = { id: string; name: string; targets: { channel: BotChannelConfig; chatId: number }[] };

// Кому и куда. Отдельной строкой здесь стоит владелец: его строка в списке
// людей («Кирилл (я)») чата не несёт — он подключает мессенджер к учётной
// записи, — поэтому его чаты спрашиваются у lib/reach, а не у строки.
// Пока поручал только он, это было неважно; с паритетом постановщиков
// задача, которую ему ставит руководитель, шла в пустоту.
//
// И отдельно — «себе»: сообщение о задаче, которую человек завёл сам себе,
// не отправляется, но и провалом не считается. Без этого различения ответ
// маршрута говорил бы «не подключён» про того, кто подключён.
async function recipientsByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: ReturnType<typeof createAdminClient>,
  names: string[],
  senderId: string,
): Promise<{ linked: Recipient[]; unlinked: string[]; self: string[] }> {
  const wanted = names.filter(Boolean);
  if (!wanted.length) return { linked: [], unlinked: [], self: [] };
  const { data } = await supabase.from("assignees").select("id, name, user_id, telegram_chat_id, max_user_id").in("name", wanted);
  const rows = (data || []) as (ColleagueRow & { user_id: string })[];
  const linked: Recipient[] = [];
  const unlinked: string[] = [];
  const self: string[] = [];
  for (const name of wanted) {
    const row = rows.find((r) => r.name === name);
    if (!row) {
      unlinked.push(name);
      continue;
    }
    if (isSelfAssignee(row.name) && row.user_id === senderId) {
      self.push(name);
      continue;
    }
    const targets = await chatsForPerson(admin, row.user_id, row);
    if (targets.length) linked.push({ id: row.id, name: row.name, targets: isSelfAssignee(row.name) ? targets : targets.slice(0, 1) });
    else unlinked.push(name);
  }
  return { linked, unlinked, self };
}

// Одно сообщение человеку: коллеге — в его мессенджер, владельцу — во все,
// что он подключил (он читает тот, что открыт).
async function deliver(
  person: Recipient,
  text: string,
  buttons: Parameters<typeof sendToColleague>[2],
): Promise<{ ok: boolean; error?: string }> {
  let error = "";
  for (const target of person.targets) {
    const result = await sendToColleague(target, text, buttons);
    if (result.ok) return { ok: true };
    error = result.error || error;
  }
  return { ok: false, error };
}

function nobodyReachable(unlinked: string[], fallback: string): string {
  return unlinked.length ? `Не подключены ни к Telegram, ни к MAX: ${unlinked.join(", ")}` : fallback;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { allowed } = await checkRateLimit(supabase, user.id, "telegram-send", 60, 60);
  if (!allowed) return NextResponse.json({ error: "Слишком много отправок подряд, подождите минуту" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const id = typeof body?.id === "string" ? body.id : "";
  const to: string[] = Array.isArray(body?.to) ? body.to.filter((n: unknown) => typeof n === "string") : [];
  if (!id || (kind !== "task" && kind !== "meeting" && kind !== "idea")) {
    return NextResponse.json({ error: "Непонятно, что отправлять" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Подпись отправителя — его имя, а не кусок почты до собаки. «📋 Задача
  // от petrov1985» читается как письмо от системы, а решение подписывается
  // именем (lib/actorName): человек, получивший задачу, первым делом хочет
  // знать, кто её поставил.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("owner_id")
    .eq("member_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const ownerId = (membership as { owner_id?: string } | null)?.owner_id || user.id;
  const from = await actorName(admin, ownerId, user.id, user.email?.split("@")[0] || "трекера");

  const sentTo: string[] = [];
  const failed: string[] = [];

  if (kind === "task") {
    const { data: task } = await supabase.from("tasks").select("id, title, description, deadline, priority, assignee").eq("id", id).maybeSingle();
    if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    const { linked, unlinked, self } = await recipientsByName(supabase, admin, to.length ? to : [task.assignee as string], user.id);
    // Задача самому себе: отправлять нечего и некому, но это не ошибка.
    if (!linked.length && self.length && !unlinked.length) return NextResponse.json({ sentTo, failed, self });
    if (!linked.length) {
      return NextResponse.json({ error: nobodyReachable(unlinked, "Некому отправлять") }, { status: 400 });
    }
    // Роль каждого на этой задаче: наблюдателю уходит то же сообщение, но
    // без кнопок ответа.
    const { data: roleRows } = await admin
      .from("task_participants")
      .select("assignee_id, role")
      .eq("task_id", task.id)
      .in("assignee_id", linked.map((p) => p.id));
    const roleOf = new Map<string, "executor" | "coexecutor" | "watcher">();
    for (const r of ((roleRows || []) as { assignee_id: string; role: "executor" | "coexecutor" | "watcher" }[])) {
      roleOf.set(r.assignee_id, r.role);
    }

    for (const person of linked) {
      const result = await deliver(person, taskMessage(task, from), taskButtons(task.id as string, roleOf.get(person.id) || "executor"));
      if (result.ok) sentTo.push(person.name);
      else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("tasks").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  if (kind === "meeting") {
    const { data: meeting } = await supabase.from("meetings").select("id, title, date, time, participants").eq("id", id).maybeSingle();
    if (!meeting) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });
    const names = to.length ? to : ((meeting.participants as string[]) || []);
    const { linked, unlinked, self } = await recipientsByName(supabase, admin, names, user.id);
    if (!linked.length && self.length && !unlinked.length) return NextResponse.json({ sentTo, failed, self });
    if (!linked.length) {
      return NextResponse.json({ error: nobodyReachable(unlinked, "Некому отправлять") }, { status: 400 });
    }
    for (const person of linked) {
      const result = await deliver(person, meetingMessage(meeting, from), meetingButtons(meeting.id as string));
      if (result.ok) sentTo.push(person.name);
      else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("meetings").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  if (kind === "idea") {
    const { data: idea } = await supabase.from("ideas").select("id, text").eq("id", id).maybeSingle();
    if (!idea) return NextResponse.json({ error: "Мысль не найдена" }, { status: 404 });
    const { linked, unlinked, self } = await recipientsByName(supabase, admin, to, user.id);
    if (!linked.length && self.length && !unlinked.length) return NextResponse.json({ sentTo, failed, self });
    if (!linked.length) {
      return NextResponse.json({ error: nobodyReachable(unlinked, "Выберите, кому отправить") }, { status: 400 });
    }
    for (const person of linked) {
      const result = await deliver(person, ideaMessage(idea.text as string, from), ideaButtons(idea.id as string));
      if (result.ok) {
        sentTo.push(person.name);
        // Кому мысль ушла — теперь строка, а не только факт отправки:
        // получатель увидит её у себя на экране, а не только в чате, и
        // будет видно, во что она превратилась.
        await admin
          .from("idea_recipients")
          .insert({ idea_id: idea.id, assignee_id: person.id, user_id: user.id })
          .then(() => undefined, () => undefined);
      } else failed.push(`${person.name} (${result.error})`);
    }
    if (sentTo.length) await admin.from("ideas").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  return NextResponse.json({ sentTo, failed });
}
