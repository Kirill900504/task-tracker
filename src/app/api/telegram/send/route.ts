import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { ideaButtons, ideaMessage, ideaShareMessage, meetingButtons, meetingMessage, taskButtons, taskMessage, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { chatsForPerson } from "@/lib/reach";
import { actorName } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import type { BotChannelConfig } from "@/lib/botTransport";
import { rememberSent } from "@/lib/botMirror";

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
//
// «Во все» — буквально: до 06.10.2026 цикл выходил на первом удачном
// отправлении, то есть владелец получал приглашение в Telegram и никогда в
// MAX, хотя комментарий выше обещал оба. Коллеге список и так из одного
// чата (recipientsByName режет его до первого), так что для него не
// меняется ничего.
async function deliver(
  person: Recipient,
  text: string,
  buttons: Parameters<typeof sendToColleague>[2],
  // Что это за сообщение — чтобы ответ, данный под ним или в другом
  // мессенджере, переписал и его (lib/botMirror). Мысль тоже (миграция
  // 0052): «Принял» в трекере обязан снять кнопки и в чате.
  memo?: { admin: ReturnType<typeof createAdminClient>; spaceId: string; kind: "task" | "meeting" | "idea"; itemId: string },
): Promise<{ ok: boolean; error?: string }> {
  // В оба мессенджера человека — одновременно (см. «одновременно» ниже).
  const results = await Promise.all(person.targets.map((target) => sendToColleague(target, text, buttons)));
  if (memo) {
    await rememberSent(
      memo.admin,
      memo.spaceId,
      { kind: memo.kind, itemId: memo.itemId, assigneeId: person.id },
      person.targets.map((target, i) => ({ ...target, messageId: results[i].ok ? results[i].messageId : undefined })),
    );
  }
  if (results.some((r) => r.ok)) return { ok: true };
  return { ok: false, error: results.map((r) => r.error).filter(Boolean).pop() || "" };
}

// «Никому не дошло» — ответ, а не ошибка запроса, поэтому со статусом 200 и
// полем `error` (его читают все вызывающие). Раньше это было 400, и каждое
// приглашение во встречу человека без мессенджера оставляло красную строку
// в консоли браузера, хотя у большинства людей мессенджера нет и это
// обычное состояние, а не сбой (QA-проход 06.10.2026).
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
    const { data: task } = await supabase.from("tasks").select("id, title, description, deadline, priority, assignee, number").eq("id", id).maybeSingle();
    if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    const { linked, unlinked, self } = await recipientsByName(supabase, admin, to.length ? to : [task.assignee as string], user.id);
    // Задача самому себе: отправлять нечего и некому, но это не ошибка.
    if (!linked.length && self.length && !unlinked.length) return NextResponse.json({ sentTo, failed, self });
    if (!linked.length) {
      return NextResponse.json({ error: nobodyReachable(unlinked, "Некому отправлять"), unreachable: unlinked });
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

    // Всем адресатам — одновременно, а не по очереди: каждая отправка — это
    // полёт до Telegram или (из Франкфурта) до MAX в России, и задача на
    // шестерых ждала шесть таких полётов подряд, пока кнопка «крутилась»
    // (07.10.2026). Итог раскладывается в исходном порядке людей.
    const results = await Promise.all(
      linked.map((person) =>
        deliver(person, taskMessage(task, from), taskButtons(task.id as string, roleOf.get(person.id) || "executor"), {
          admin,
          spaceId: ownerId,
          kind: "task",
          itemId: task.id as string,
        }),
      ),
    );
    results.forEach((result, i) => {
      if (result.ok) sentTo.push(linked[i].name);
      else failed.push(`${linked[i].name} (${result.error})`);
    });
    if (sentTo.length) await admin.from("tasks").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  if (kind === "meeting") {
    const { data: meeting } = await supabase.from("meetings").select("id, title, date, time, participants").eq("id", id).maybeSingle();
    if (!meeting) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });
    const names = to.length ? to : ((meeting.participants as string[]) || []);
    const { linked, unlinked, self } = await recipientsByName(supabase, admin, names, user.id);
    if (!linked.length && self.length && !unlinked.length) return NextResponse.json({ sentTo, failed, self });
    if (!linked.length) {
      return NextResponse.json({ error: nobodyReachable(unlinked, "Некому отправлять"), unreachable: unlinked });
    }
    const results = await Promise.all(
      linked.map((person) =>
        deliver(person, meetingMessage(meeting, from), meetingButtons(meeting.id as string), {
          admin,
          spaceId: ownerId,
          kind: "meeting",
          itemId: meeting.id as string,
        }),
      ),
    );
    results.forEach((result, i) => {
      if (result.ok) sentTo.push(linked[i].name);
      else failed.push(`${linked[i].name} (${result.error})`);
    });
    if (sentTo.length) await admin.from("meetings").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  if (kind === "idea") {
    // Отправить или поделиться (миграция 0051, решение Кирилла 23.09.2026).
    // Всё, что не «share», — «send», как было до этого всегда.
    const mode: "send" | "share" = body?.mode === "share" ? "share" : "send";
    const { data: idea } = await supabase.from("ideas").select("id, text").eq("id", id).maybeSingle();
    if (!idea) return NextResponse.json({ error: "Мысль не найдена" }, { status: 404 });
    const { linked, unlinked, self } = await recipientsByName(supabase, admin, to, user.id);
    if (!linked.length && self.length && !unlinked.length) return NextResponse.json({ sentTo, failed, self });
    if (!linked.length) {
      return NextResponse.json({ error: nobodyReachable(unlinked, "Выберите, кому отправить"), unreachable: unlinked });
    }
    // «Сохранить мысль» — только тем, у кого есть свой список мыслей, то
    // есть вход в трекер (членство или своя строка владельца «(я)»).
    const { data: members } = await admin
      .from("workspace_members")
      .select("assignee_id")
      .in("assignee_id", linked.map((p) => p.id))
      .eq("status", "active")
      .not("member_id", "is", null);
    const withLogin = new Set(((members || []) as { assignee_id: string }[]).map((m) => m.assignee_id));
    const results = await Promise.all(
      linked.map((person) =>
        deliver(
          person,
          mode === "share" ? ideaShareMessage(idea.text as string, from) : ideaMessage(idea.text as string, from),
          ideaButtons(idea.id as string, { canKeep: withLogin.has(person.id) || isSelfAssignee(person.name) }),
          { admin, spaceId: ownerId, kind: "idea", itemId: idea.id as string },
        ),
      ),
    );
    const reached = linked.filter((_, i) => results[i].ok);
    results.forEach((result, i) => {
      if (result.ok) sentTo.push(linked[i].name);
      else failed.push(`${linked[i].name} (${result.error})`);
    });
    // Кому мысль ушла — теперь строка, а не только факт отправки:
    // получатель увидит её у себя на экране, а не только в чате, и будет
    // видно, во что она превратилась. Одной записью на всех — upsert с
    // пропуском дублей: у таблицы unique (idea_id, assignee_id), и вставка
    // пачкой при повторной отправке тому же человеку упала бы ЦЕЛИКОМ,
    // унеся с собой и новых получателей (правило из CLAUDE.md).
    if (reached.length) {
      await admin
        .from("idea_recipients")
        .upsert(
          reached.map((person) => ({ idea_id: idea.id, assignee_id: person.id, user_id: user.id, kind: mode })),
          { onConflict: "idea_id,assignee_id", ignoreDuplicates: true },
        )
        .then(() => undefined, () => undefined);
    }
    if (sentTo.length) await admin.from("ideas").update({ sent_at: new Date().toISOString() }).eq("id", id);
  }

  return NextResponse.json({ sentTo, failed });
}
