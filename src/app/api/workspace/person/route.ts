import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { personInput, readInput } from "@/lib/apiInput";
import { isSelfAssignee } from "@/lib/trackerRows";
import { todayStr } from "@/lib/taskDisplay";
import { recordEvent } from "@/lib/itemHistory";
import { sendToPerson } from "@/lib/reach";
import { withoutSelfMark } from "@/lib/actorName";
import { ownerSeesTask, ownerSight } from "@/lib/ownerVisible";

// Люди в «Команде»: завести, убрать, вернуть (14.10.2026).
//
// Слова Кирилла: «в разделе команда добавь функционал добавлять новых и
// удалять не нужных людей». До этого человека можно было завести только
// изнутри карточки задачи («+ человек»), а убрать — никак.
//
// «Убрать» — НЕ удаление строки, и это главное, что здесь нельзя
// упростить. На строку `assignees` каскадом держится всё участие человека:
// «принял», «сделал» с комментарием и файлами, голоса по встречам. Такой
// каскад однажды уже стёр Михаила Котова со всей историей. Поэтому
// человек помечается (`archived_at`, миграция 0055): уходит из «Команды»,
// из всех списков выбора и из разбора имён в боте, теряет вход и
// мессенджер, а закрытые задачи продолжают говорить, кто их делал.
// По-настоящему удаляется только строка без единого следа — опечатка или
// дубль, где терять нечего.
//
// И второе, ради чего трекер вообще существует: открытая работа не
// уходит вместе с человеком. Задача на ушедшем — это ровно то
// «поручил и забыл», от чего трекер должен защищать: её никто не сделает
// и никто о ней не спросит. Поэтому убрать человека с открытыми делами
// можно только назвав, кому они переходят; маршрут сначала отвечает, что
// у него есть (dryRun), и интерфейс спрашивает получателя.
//
// Право — у владельца, как и вся «Команда».

type Person = { id: string; user_id: string; name: string; archived_at: string | null };

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, personInput);
  if (badInput) return badInput;

  const admin = createAdminClient();

  if (body.action === "add") return addPerson(admin, user.id, body.name);

  const { data: row } = await admin
    .from("assignees")
    .select("id, user_id, name, archived_at")
    .eq("id", body.assigneeId)
    .maybeSingle();
  const person = row as Person | null;
  if (!person) return NextResponse.json({ error: "Человек не найден" }, { status: 404 });
  if (person.user_id !== user.id) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });

  if (body.action === "restore") {
    const { error } = await admin.from("assignees").update({ archived_at: null }).eq("id", person.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, name: person.name });
  }

  // Себя убрать нельзя: строка «(я)» — это то, по чему трекер узнаёт
  // владельца (isSelfAssignee), и без неё перестанут работать его ответы.
  if (isSelfAssignee(person.name)) return NextResponse.json({ error: "Себя из команды убрать нельзя" }, { status: 400 });
  if (person.archived_at) return NextResponse.json({ ok: true, archived: true, already: true });

  const work = await openWork(admin, person);
  const total = work.tasks.length + work.meetings.length + work.authoredTasks.length + work.authoredMeetings.length;

  if (body.dryRun) {
    // Названия — только того, что владелец и так видит на доске (своё и где
    // он участник). Остальное — числом: поручения уходящего другим людям
    // ему не показываются нигде в трекере, и окно «кому передать» не
    // повод сделать исключение (аудит приватности, 15.10.2026).
    const all = [...work.tasks, ...work.authoredTasks];
    const [{ data: authors }, sight] = await Promise.all([
      admin.from("tasks").select("id, created_by").in("id", all.map((t) => t.id)),
      ownerSight(admin, user.id),
    ]);
    const authorOf = new Map(((authors || []) as { id: string; created_by: string | null }[]).map((t) => [t.id, t.created_by]));
    const visible = all.filter((t) => ownerSeesTask(sight, { id: t.id, created_by: authorOf.get(t.id) ?? null }));
    return NextResponse.json({
      ok: true,
      openTasks: work.tasks.length + work.authoredTasks.length,
      openMeetings: work.meetings.length + work.authoredMeetings.length,
      // Несколько названий — чтобы вопрос «кому передать» говорил о
      // настоящих делах, а не о числе.
      sample: visible.slice(0, 4).map((t) => (t.number ? `№${t.number} ` : "") + t.title),
    });
  }

  let receiver: Person | null = null;
  if (total > 0) {
    if (!body.transferTo) {
      return NextResponse.json({ error: "Сначала назовите, кому передать открытые дела" }, { status: 400 });
    }
    const { data: to } = await admin
      .from("assignees")
      .select("id, user_id, name, archived_at")
      .eq("id", body.transferTo)
      .maybeSingle();
    receiver = to as Person | null;
    if (!receiver || receiver.user_id !== user.id || receiver.archived_at || receiver.id === person.id) {
      return NextResponse.json({ error: "Передать некому: этого человека нет в команде" }, { status: 400 });
    }
    const problem = await transferWork(admin, user.id, person, receiver, work);
    // Передача, прошедшая наполовину, — повод остановиться, а не убирать
    // человека: недоставшаяся задача осталась бы на ушедшем.
    if (problem) return NextResponse.json({ error: `Передать дела не удалось: ${problem}` }, { status: 500 });
  }

  const archived = await retire(admin, person);
  if ("error" in archived) return NextResponse.json({ error: archived.error }, { status: 500 });

  // Получателю — одно сообщение обо всём сразу, а не по строке на задачу.
  if (receiver && total > 0) {
    const titles = [...work.tasks, ...work.authoredTasks].map((t) => (t.number ? `№${t.number} ` : "") + t.title);
    const lines = [`📥 Вам переданы дела: ${withoutSelfMark(person.name)} больше не в команде.`];
    if (titles.length) lines.push("", "Задачи:", ...titles.slice(0, 15).map((t) => `• ${t}`));
    if (titles.length > 15) lines.push(`…и ещё ${titles.length - 15}`);
    const meetings = work.meetings.length + work.authoredMeetings.length;
    if (meetings) lines.push("", `Встречи: ${meetings}`);
    const { data: full } = await admin
      .from("assignees")
      .select("id, name, telegram_chat_id, max_user_id")
      .eq("id", receiver.id)
      .maybeSingle();
    // Себе владелец сообщений не шлёт: он только что нажал кнопку сам.
    if (full && !isSelfAssignee(receiver.name)) {
      await sendToPerson(admin, user.id, full as { id: string; name: string; telegram_chat_id: number | null; max_user_id: number | null }, lines.join("\n")).catch(() => 0);
    }
  }

  return NextResponse.json({
    ok: true,
    archived: archived.archived,
    moved: { tasks: work.tasks.length + work.authoredTasks.length, meetings: work.meetings.length + work.authoredMeetings.length },
    to: receiver ? withoutSelfMark(receiver.name) : null,
  });
}

// Завести человека. Убранный с тем же именем возвращается, а не
// заводится вторым: имя в пространстве уникально (unique user_id, name),
// и вторая строка с тем же именем была бы отвергнута базой — а человек,
// которого вернули, получает назад и свою историю.
async function addPerson(admin: SupabaseClient, ownerId: string, raw: string) {
  const name = raw.replace(/\s+/g, " ").replace(/\s*\(я\)\s*$/i, "").trim();
  if (!name) return NextResponse.json({ error: "Имя не может быть пустым" }, { status: 400 });
  const { data: existing } = await admin
    .from("assignees")
    .select("id, archived_at")
    .eq("user_id", ownerId)
    .eq("name", name)
    .maybeSingle();
  const found = existing as { id: string; archived_at: string | null } | null;
  if (found && !found.archived_at) return NextResponse.json({ error: `«${name}» уже есть в команде` }, { status: 400 });
  if (found) {
    const { error } = await admin.from("assignees").update({ archived_at: null }).eq("id", found.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: found.id, name, restored: true });
  }
  const { data: inserted, error } = await admin
    .from("assignees")
    .insert({ user_id: ownerId, name })
    .select("id")
    .single();
  if (error || !inserted) return NextResponse.json({ error: error?.message || "Не получилось добавить" }, { status: 500 });
  return NextResponse.json({ ok: true, id: (inserted as { id: string }).id, name });
}

type OpenTask = { id: string; title: string; number: number | null; assignee: string; partId?: string; role?: string };
type OpenMeeting = { id: string; title: string; participants: string[]; partId?: string; role?: string };
type Work = { tasks: OpenTask[]; meetings: OpenMeeting[]; authoredTasks: OpenTask[]; authoredMeetings: OpenMeeting[]; memberId: string | null };

// Что на человеке ещё не закрыто: задачи, где он участник, будущие
// встречи, куда его позвали, и то, что он сам поручил или собрал (если у
// него был вход). Закрытое не трогается — это история.
async function openWork(admin: SupabaseClient, person: Person): Promise<Work> {
  const today = todayStr();
  const [{ data: parts }, { data: mparts }, { data: member }] = await Promise.all([
    admin
      .from("task_participants")
      .select("id, role, task_id, tasks(id, title, number, assignee, status, deleted_at)")
      .eq("assignee_id", person.id),
    admin
      .from("meeting_participants")
      .select("id, role, meeting_id, meetings(id, title, participants, status, date, deleted_at)")
      .eq("assignee_id", person.id),
    admin.from("workspace_members").select("member_id").eq("assignee_id", person.id).maybeSingle(),
  ]);

  type TaskJoin = { id: string; title: string; number: number | null; assignee: string; status: string; deleted_at: string | null };
  type MeetingJoin = { id: string; title: string; participants: string[] | null; status: string; date: string; deleted_at: string | null };
  const openTask = (t: TaskJoin | null) => !!t && !t.deleted_at && t.status !== "done";
  const openMeeting = (m: MeetingJoin | null) =>
    !!m && !m.deleted_at && (m.status === "planned" || m.status === "proposed") && m.date >= today;

  const tasks: OpenTask[] = [];
  for (const p of (parts || []) as unknown as { id: string; role: string; tasks: TaskJoin | null }[]) {
    if (!openTask(p.tasks)) continue;
    const t = p.tasks!;
    tasks.push({ id: t.id, title: t.title, number: t.number, assignee: t.assignee || "", partId: p.id, role: p.role });
  }
  const meetings: OpenMeeting[] = [];
  for (const p of (mparts || []) as unknown as { id: string; role: string; meetings: MeetingJoin | null }[]) {
    if (!openMeeting(p.meetings)) continue;
    const m = p.meetings!;
    meetings.push({ id: m.id, title: m.title, participants: m.participants || [], partId: p.id, role: p.role });
  }

  const memberId = ((member as { member_id: string | null } | null)?.member_id as string | null) || null;
  let authoredTasks: OpenTask[] = [];
  let authoredMeetings: OpenMeeting[] = [];
  if (memberId) {
    const [{ data: at }, { data: am }] = await Promise.all([
      admin.from("tasks").select("id, title, number, assignee, status, deleted_at").eq("created_by", memberId),
      admin.from("meetings").select("id, title, participants, status, date, deleted_at").eq("created_by", memberId),
    ]);
    const mine = new Set(tasks.map((t) => t.id));
    authoredTasks = ((at || []) as TaskJoin[])
      .filter((t) => openTask(t) && !mine.has(t.id))
      .map((t) => ({ id: t.id, title: t.title, number: t.number, assignee: t.assignee || "" }));
    const mineM = new Set(meetings.map((m) => m.id));
    authoredMeetings = ((am || []) as MeetingJoin[])
      .filter((m) => openMeeting(m) && !mineM.has(m.id))
      .map((m) => ({ id: m.id, title: m.title, participants: m.participants || [] }));
  }
  return { tasks, meetings, authoredTasks, authoredMeetings, memberId };
}

async function transferWork(admin: SupabaseClient, ownerId: string, from: Person, to: Person, work: Work): Promise<string> {
  const fromName = withoutSelfMark(from.name);
  const toName = withoutSelfMark(to.name);

  // Поручения ушедшего: постановщиком становится получатель, если у него
  // есть вход, иначе — владелец (у его строк created_by пуст, см.
  // lib/ownership). Иначе исполнитель отчитывался бы в пустоту.
  const { data: toMember } = await admin
    .from("workspace_members")
    .select("member_id, status")
    .eq("assignee_id", to.id)
    .maybeSingle();
  const tm = toMember as { member_id: string | null; status: string } | null;
  const newAuthor = !isSelfAssignee(to.name) && tm?.member_id && tm.status === "active" ? tm.member_id : null;

  for (const t of work.tasks) {
    // Строка ушедшего снимается, у получателя заводится своя — с пустыми
    // ответами: «принял» и «сделал» ушедшего — не его слова. Если
    // получатель уже стоит на задаче, остаётся его строка как есть.
    const { error: delError } = await admin.from("task_participants").delete().eq("id", t.partId!);
    if (delError) return delError.message;
    const { error: insError } = await admin
      .from("task_participants")
      .upsert({ task_id: t.id, assignee_id: to.id, role: t.role || "executor", user_id: ownerId }, { onConflict: "task_id,assignee_id", ignoreDuplicates: true });
    if (insError) return insError.message;
    if (t.assignee === from.name) await admin.from("tasks").update({ assignee: to.name }).eq("id", t.id);
    await recordEvent(admin, { userId: ownerId, kind: "task", itemId: t.id, text: `${fromName} больше не в команде — задача передана: ${toName}`, actorUserId: ownerId });
  }

  for (const m of work.meetings) {
    const { error: delError } = await admin.from("meeting_participants").delete().eq("id", m.partId!);
    if (delError) return delError.message;
    const { error: insError } = await admin
      .from("meeting_participants")
      .upsert({ meeting_id: m.id, assignee_id: to.id, role: m.role || "participant", user_id: ownerId }, { onConflict: "meeting_id,assignee_id", ignoreDuplicates: true });
    if (insError) return insError.message;
    const names = m.participants.filter((n) => n !== from.name);
    if (!names.includes(to.name)) names.push(to.name);
    await admin.from("meetings").update({ participants: names }).eq("id", m.id);
    await recordEvent(admin, { userId: ownerId, kind: "meeting", itemId: m.id, text: `${fromName} больше не в команде — вместо него: ${toName}`, actorUserId: ownerId });
  }

  for (const t of work.authoredTasks) {
    const { error } = await admin.from("tasks").update({ created_by: newAuthor }).eq("id", t.id);
    if (error) return error.message;
    await recordEvent(admin, { userId: ownerId, kind: "task", itemId: t.id, text: `${fromName} больше не в команде — постановщик теперь ${newAuthor ? toName : "владелец"}`, actorUserId: ownerId });
  }
  for (const m of work.authoredMeetings) {
    const { error } = await admin.from("meetings").update({ created_by: newAuthor }).eq("id", m.id);
    if (error) return error.message;
  }
  return "";
}

// Убрать: удалить строку, если от человека не осталось ничего, иначе
// пометить и закрыть все двери — вход, мессенджеры, ссылки, разделы.
async function retire(admin: SupabaseClient, person: Person): Promise<{ archived: boolean } | { error: string }> {
  const counts = await Promise.all([
    admin.from("task_participants").select("id", { count: "exact", head: true }).eq("assignee_id", person.id),
    admin.from("meeting_participants").select("id", { count: "exact", head: true }).eq("assignee_id", person.id),
    admin.from("idea_recipients").select("id", { count: "exact", head: true }).eq("assignee_id", person.id),
    admin.from("item_comments").select("id", { count: "exact", head: true }).eq("author_assignee_id", person.id),
    admin.from("workspace_members").select("id", { count: "exact", head: true }).eq("assignee_id", person.id).not("member_id", "is", null),
  ]);
  // Ошибка подсчёта — не «следов нет»: удалять вслепую нельзя.
  const failed = counts.find((c) => c.error);
  const traceless = !failed && counts.every((c) => (c.count || 0) === 0);

  if (traceless) {
    const { error } = await admin.from("assignees").delete().eq("id", person.id);
    if (error) return { error: error.message };
    return { archived: false };
  }

  const { error } = await admin
    .from("assignees")
    .update({
      archived_at: new Date().toISOString(),
      telegram_chat_id: null,
      telegram_username: null,
      linked_at: null,
      max_user_id: null,
      max_username: null,
      max_linked_at: null,
    })
    .eq("id", person.id);
  if (error) return { error: error.message };
  // Вход — так же, как «Отключить вход»: отключённый не получает ни одной
  // двери (см. lib/cabinet). Остальное — то, что могло бы человека вернуть
  // в обход: неиспользованные ссылки и закрепление за разделами.
  await Promise.all([
    admin.from("workspace_members").update({ status: "disabled", disabled_at: new Date().toISOString() }).eq("assignee_id", person.id),
    admin.from("workspace_invites").delete().eq("assignee_id", person.id),
    admin.from("telegram_link_codes").delete().eq("assignee_id", person.id),
    admin.from("section_assignees").delete().eq("assignee_id", person.id),
  ]);
  return { archived: true };
}
