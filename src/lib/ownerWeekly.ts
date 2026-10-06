import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";
import { withoutSelfMark } from "@/lib/actorName";
import { sortNames } from "@/lib/peopleOrder";
import { dateStr } from "@/lib/taskLogic";

// Пятничный отчёт владельцу: неделя всего пространства, по людям.
//
// Он существует потому, что 23.09.2026 видимость стала строго личной — и
// для самого владельца тоже. Чужие задачи и встречи больше не лежат у него
// на экране, и это был обмен, а не потеря: вместо постоянного подглядывания
// — одна фотография в неделю. Значит отчёт отвечает на то, на что раньше
// отвечал взгляд на чужую доску: кто ставит, кто получает, что закрывается,
// что лежит забытым и кто с кем вообще работает.
//
// Это ЛИЧНЫЙ инструмент владельца. Ни в мануал для коллег, ни в
// docs/how-it-works.md он не попадает — его просьба, сказанная прямо.
// Поэтому и уходит он только notifyOwner, мимо очереди уведомлений
// постановщикам.
//
// Три правила формы, и все три — его.
// *Без рейтинга.* Люди идут в обычном порядке (`peopleOrder`), а не по
// «результативности»: таблица мест учит набирать мелкие задачи ради
// цифры, а не показывает, как есть.
// *Ноль контактов — повод спросить, а не приговор.* Пара, которая за
// неделю не пересеклась, может работать через третьего или просто не иметь
// общего дела; отчёт так и говорит.
// *Цифры считает код.* Модели здесь нет вовсе: каждое число должно
// открываться списком, в котором ровно столько строк.

const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN = "Без имени";

export type WTask = {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  deadline: string;
  completedAt: string | null;
};

export type WPart = {
  taskId: string;
  person: string;
  role: string;
  createdAt: string;
  acceptedAt: string | null;
  doneAt: string | null;
  declinedAt: string | null;
};

export type WMeeting = {
  id: string;
  author: string;
  date: string;
  status: string;
  movedToDate: string | null;
  people: string[];
};

export type WIdea = {
  id: string;
  author: string;
  createdAt: string;
  recipients: string[];
};

export type WeeklyInput = {
  people: string[];
  tasks: WTask[];
  parts: WPart[];
  meetings: WMeeting[];
  ideas: WIdea[];
};

export type PersonWeek = {
  name: string;
  assigned: number;
  assignedToOthers: number;
  received: number;
  completed: number;
  backlog: number;
  overdue: number;
  ideas: number;
  meetings: number;
  avgReactHours: number | null;
  avgDoneDays: number | null;
};

export type OwnerWeekly = {
  from: string;
  to: string;
  snapshot: {
    active: number;
    created: number;
    closed: number;
    overdue: number;
    meetingsHeld: number;
    meetingsNoRecap: number;
    ideas: number;
    avgResolveDays: number | null;
  };
  people: PersonWeek[];
  quiet: string[];
  pairs: { a: string; b: string; count: number }[];
  pairsPossible: number;
  noContact: string[];
  aging: [number, number, number, number];
  stale: { title: string; author: string; days: number }[];
  reaction: { avgHours: number | null; answered: number; waiting: number };
};

function avg(list: number[]): number | null {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

function since(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return b - a;
}

export function buildOwnerWeekly(input: WeeklyInput, now: Date): OwnerWeekly {
  const nowMs = now.getTime();
  const weekAgoMs = nowMs - 7 * DAY;
  const weekAgo = new Date(weekAgoMs).toISOString();
  const today = dateStr(now);
  const fromDay = dateStr(new Date(weekAgoMs));
  const inWeek = (iso: string | null | undefined) => !!iso && iso >= weekAgo;

  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  // Строка участия задачи, которой больше нет (удалена), в отчёт не идёт:
  // tasks уже отфильтрованы по deleted_at.
  const parts = input.parts.filter((p) => taskById.has(p.taskId));
  const doers = parts.filter((p) => p.role === "executor" || p.role === "coexecutor");

  const isActive = (t: WTask) => t.status !== "done";
  const active = input.tasks.filter(isActive);
  const closedThisWeek = input.tasks.filter((t) => !isActive(t) && inWeek(t.completedAt));

  // Встреча «прошла», если у неё есть исход и это не перенос: перенесённая
  // закрывается тем же статусом, но разговора не было.
  const held = input.meetings.filter(
    (m) => m.date >= fromDay && m.date <= today && (m.status === "success" || m.status === "no_result") && !m.movedToDate,
  );
  const noRecap = input.meetings.filter((m) => m.status === "planned" && m.date < today);
  const ideasThisWeek = input.ideas.filter((i) => inWeek(i.createdAt));

  const resolveDays = closedThisWeek
    .map((t) => since(t.createdAt, t.completedAt!))
    .filter((ms): ms is number => ms !== null)
    .map((ms) => ms / DAY);

  // ---- по людям

  const names = sortNames([...new Set([...input.people, ...input.tasks.map((t) => t.author)].filter((n) => n && n !== UNKNOWN))]);
  const people: PersonWeek[] = [];
  const quiet: string[] = [];
  for (const name of names) {
    const authored = input.tasks.filter((t) => t.author === name && inWeek(t.createdAt));
    const toOthers = authored.filter((t) => doers.some((p) => p.taskId === t.id && p.person !== name));
    const mine = doers.filter((p) => p.person === name);
    const received = mine.filter((p) => inWeek(p.createdAt) && taskById.get(p.taskId)!.author !== name);
    const open = mine.filter((p) => !p.doneAt && !p.declinedAt && isActive(taskById.get(p.taskId)!));
    const done = mine.filter((p) => inWeek(p.doneAt));
    const reacted = mine
      .filter((p) => taskById.get(p.taskId)!.author !== name)
      .map((p) => {
        const first = [p.acceptedAt, p.declinedAt].filter((x): x is string => !!x).sort()[0];
        return first && inWeek(first) ? since(p.createdAt, first) : null;
      })
      .filter((ms): ms is number => ms !== null);
    const doneDays = done.map((p) => since(p.createdAt, p.doneAt!)).filter((ms): ms is number => ms !== null);

    const row: PersonWeek = {
      name,
      assigned: authored.length,
      assignedToOthers: toOthers.length,
      received: received.length,
      completed: done.length,
      backlog: open.length,
      overdue: open.filter((p) => {
        const d = taskById.get(p.taskId)!.deadline;
        return !!d && d < today;
      }).length,
      ideas: ideasThisWeek.filter((i) => i.author === name).length,
      meetings: held.filter((m) => m.author === name || m.people.includes(name)).length,
      avgReactHours: reacted.length ? avg(reacted)! / (60 * 60 * 1000) : null,
      avgDoneDays: doneDays.length ? avg(doneDays)! / DAY : null,
    };
    const moved = row.assigned || row.received || row.completed || row.ideas || row.meetings;
    if (moved || row.backlog) people.push(row);
    else quiet.push(name);
  }

  // ---- кто с кем
  //
  // Контакт — это общее ДЕЛО за неделю: задача, поставленная одним другому
  // (по строке участия, а не по полю «Исполнитель»), прошедшая встреча
  // организатора с участником и мысль, отправленная человеку.

  const pairCount = new Map<string, number>();
  const touch = (a: string, b: string) => {
    if (!a || !b || a === b || a === UNKNOWN || b === UNKNOWN) return;
    const [x, y] = [a, b].sort((p, q) => p.localeCompare(q, "ru"));
    const key = x + "\u0000" + y;
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  };
  // По задаче контакт — не только поручение, но и ответ на него: сданная на
  // этой неделе работа по задаче месячной давности — тоже общее дело.
  for (const p of parts) {
    const t = taskById.get(p.taskId)!;
    if ([p.createdAt, p.acceptedAt, p.doneAt, p.declinedAt].some(inWeek)) touch(t.author, p.person);
  }
  for (const m of held) for (const who of m.people) touch(m.author, who);
  for (const i of ideasThisWeek) for (const who of i.recipients) touch(i.author, who);

  const pairs = [...pairCount.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split("\u0000");
      return { a, b, count };
    })
    .sort((p, q) => q.count - p.count || p.a.localeCompare(q.a, "ru") || p.b.localeCompare(q.b, "ru"));
  const connected = new Set(pairs.flatMap((p) => [p.a, p.b]));
  // Отсутствие контакта считается только среди тех, кто вообще работал на
  // этой неделе: человек в отпуске «ни с кем не пересёкся» по определению,
  // и называть его здесь — шум.
  const working = people.filter((p) => p.assigned || p.received || p.completed || p.ideas || p.meetings).map((p) => p.name);
  const noContact = working.filter((n) => !connected.has(n));

  // ---- возраст и забытое

  const aging: [number, number, number, number] = [0, 0, 0, 0];
  for (const t of active) {
    const days = Math.floor((nowMs - Date.parse(t.createdAt)) / DAY);
    aging[days <= 2 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : 3]++;
  }

  // «Забыто» — ни правки самой задачи, ни единого нажатия по ней за семь
  // дней. Ровно та беда, ради которой трекер заводился: поручил десятерым,
  // помнишь про двоих.
  const lastMove = (t: WTask) =>
    [t.updatedAt, ...parts.filter((p) => p.taskId === t.id).flatMap((p) => [p.createdAt, p.acceptedAt, p.doneAt, p.declinedAt])]
      .filter((x): x is string => !!x)
      .sort()
      .pop() || t.createdAt;
  const stale = active
    .map((t) => ({ t, last: lastMove(t) }))
    .filter(({ last }) => last < weekAgo)
    .map(({ t, last }) => ({ title: t.title, author: t.author, days: Math.floor((nowMs - Date.parse(last)) / DAY) }))
    .sort((a, b) => b.days - a.days);

  // ---- скорость отклика по всему пространству

  const answered = doers
    .filter((p) => taskById.get(p.taskId)!.author !== p.person)
    .map((p) => {
      const first = [p.acceptedAt, p.declinedAt].filter((x): x is string => !!x).sort()[0];
      return first && inWeek(first) ? since(p.createdAt, first) : null;
    })
    .filter((ms): ms is number => ms !== null);
  const waiting = doers.filter(
    (p) =>
      !p.acceptedAt &&
      !p.declinedAt &&
      !p.doneAt &&
      isActive(taskById.get(p.taskId)!) &&
      taskById.get(p.taskId)!.author !== p.person &&
      Date.parse(p.createdAt) < nowMs - DAY,
  ).length;

  return {
    from: fromDay,
    to: today,
    snapshot: {
      active: active.length,
      created: input.tasks.filter((t) => inWeek(t.createdAt)).length,
      closed: closedThisWeek.length,
      overdue: active.filter((t) => t.deadline && t.deadline < today).length,
      meetingsHeld: held.length,
      meetingsNoRecap: noRecap.length,
      ideas: ideasThisWeek.length,
      avgResolveDays: avg(resolveDays),
    },
    people,
    quiet,
    pairs,
    pairsPossible: (working.length * (working.length - 1)) / 2,
    noContact,
    aging,
    stale,
    reaction: { avgHours: answered.length ? avg(answered)! / (60 * 60 * 1000) : null, answered: answered.length, waiting },
  };
}

// ------------------------------------------------------------------ текст

function ru(d: string): string {
  return d.split("-").reverse().slice(0, 2).join(".");
}

function hours(h: number): string {
  if (h < 1) return "меньше часа";
  if (h < 24) return `${Math.round(h)} ч`;
  return `${Math.round(h / 24)} дн`;
}

function days(d: number): string {
  return d < 1 ? "меньше дня" : `${Math.round(d)} дн`;
}

export function ownerWeeklyIsEmpty(w: OwnerWeekly): boolean {
  const s = w.snapshot;
  return !s.active && !s.created && !s.closed && !s.meetingsHeld && !s.ideas;
}

// Длинное письмо режется по разделам, а не посреди строки: MAX не
// принимает больше 4000 знаков, Telegram — больше 4096, а у четырнадцати
// человек раздел «по людям» один занимает пару тысяч.
const PART_LIMIT = 3500;

export function composeOwnerWeekly(w: OwnerWeekly): string[] {
  if (ownerWeeklyIsEmpty(w)) return [];
  const s = w.snapshot;
  const sections: string[] = [];

  const head = [`🗂 Неделя трекера ${ru(w.from)}–${ru(w.to)} · только для вас`, ""];
  head.push(`Задачи: в работе ${s.active}, новых ${s.created}, закрыто ${s.closed}, просрочено ${s.overdue}.`);
  head.push(
    `Встречи: прошло ${s.meetingsHeld}` + (s.meetingsNoRecap ? `, без итога ${s.meetingsNoRecap}` : "") + `. Мыслей записано: ${s.ideas}.`,
  );
  if (s.avgResolveDays !== null) head.push(`Закрытое на этой неделе в среднем жило ${days(s.avgResolveDays)}.`);
  if (w.reaction.avgHours !== null || w.reaction.waiting) {
    const bits: string[] = [];
    if (w.reaction.avgHours !== null) bits.push(`от поручения до первого ответа в среднем ${hours(w.reaction.avgHours)}`);
    if (w.reaction.waiting) bits.push(`без ответа дольше суток: ${w.reaction.waiting}`);
    head.push("Отклик: " + bits.join("; ") + ".");
  }
  sections.push(head.join("\n"));

  if (w.people.length) {
    const lines = ["👥 По людям (порядок обычный, не рейтинг)"];
    for (const p of w.people) {
      const bits: string[] = [];
      if (p.assigned) bits.push(`поставил ${p.assigned}` + (p.assignedToOthers !== p.assigned ? ` (другим ${p.assignedToOthers})` : ""));
      if (p.received) bits.push(`получил ${p.received}`);
      if (p.completed) bits.push(`сделал ${p.completed}`);
      if (p.backlog) bits.push(`на нём ${p.backlog}`);
      if (p.overdue) bits.push(`просрочено ${p.overdue}`);
      if (p.meetings) bits.push(`встреч ${p.meetings}`);
      if (p.ideas) bits.push(`мыслей ${p.ideas}`);
      if (p.avgReactHours !== null) bits.push(`отвечает за ${hours(p.avgReactHours)}`);
      if (p.avgDoneDays !== null) bits.push(`делает за ${days(p.avgDoneDays)}`);
      // Баланс словами только там, где он перекошен: «больше раздаёт» и
      // «больше исполняет» — две разные роли, а не хорошо и плохо.
      let lean = "";
      if (p.assignedToOthers >= 3 && p.assignedToOthers >= 2 * Math.max(p.received, 1)) lean = " — больше поручает";
      else if (p.received >= 3 && p.received >= 2 * Math.max(p.assignedToOthers, 1)) lean = " — больше исполняет";
      lines.push(`• ${p.name}: ${bits.join(", ")}${lean}`);
    }
    if (w.quiet.length) lines.push("", "Без движения за неделю: " + w.quiet.join(", "));
    sections.push(lines.join("\n"));
  }

  if (w.pairs.length || w.noContact.length) {
    const lines = ["🤝 Кто с кем работал"];
    if (w.pairsPossible) lines.push(`Пар с общим делом: ${w.pairs.length} из ${w.pairsPossible} возможных.`);
    for (const p of w.pairs.slice(0, 12)) lines.push(`• ${p.a} ↔ ${p.b}: ${p.count}`);
    if (w.pairs.length > 12) lines.push(`…и ещё ${w.pairs.length - 12}`);
    if (w.noContact.length) {
      lines.push(
        "",
        "Работали, но ни с кем не пересеклись: " +
          w.noContact.join(", ") +
          ". Это повод спросить, а не вывод — дело могло идти через третьего.",
      );
    }
    sections.push(lines.join("\n"));
  }

  if (s.active) {
    const [a, b, c, d] = w.aging;
    const lines = ["⏳ Возраст задач в работе", `0–2 дн: ${a} · 3–7: ${b} · 8–14: ${c} · 15+: ${d}`];
    if (w.stale.length) {
      lines.push("", `Без движения 7+ дней (${w.stale.length}):`);
      for (const t of w.stale.slice(0, 10)) lines.push(`• ${t.title} — ${t.author}, ${t.days} дн`);
      if (w.stale.length > 10) lines.push(`…и ещё ${w.stale.length - 10}`);
    }
    sections.push(lines.join("\n"));
  }

  // Раздел, который сам длиннее письма, режется по строкам: обрезать его
  // многоточием значило бы молча потерять людей с конца списка.
  const pieces = sections.flatMap((sec) => {
    if (sec.length <= PART_LIMIT) return [sec];
    const chunks: string[] = [];
    let buf = "";
    for (const line of sec.split("\n")) {
      if (buf && buf.length + line.length + 1 > PART_LIMIT) {
        chunks.push(buf);
        buf = line.slice(0, PART_LIMIT);
      } else buf = buf ? buf + "\n" + line : line.slice(0, PART_LIMIT);
    }
    if (buf) chunks.push(buf);
    return chunks;
  });

  const out: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 2 > PART_LIMIT) {
      out.push(cur);
      cur = piece;
    } else cur = cur ? cur + "\n\n" + piece : piece;
  }
  if (cur) out.push(cur);
  return out;
}

// ------------------------------------------------------------------ данные

export async function loadOwnerWeekly(admin: SupabaseClient, ownerId: string): Promise<WeeklyInput> {
  const [people, members, tasks, parts, meetings, mparts, ideas, recips] = await Promise.all([
    admin.from("assignees").select("id, name").eq("user_id", ownerId),
    admin.from("workspace_members").select("member_id, assignee_id").eq("owner_id", ownerId),
    admin
      .from("tasks")
      .select("id, title, created_by, created_at, updated_at, status, deadline, completed_at")
      .eq("user_id", ownerId)
      .is("deleted_at", null),
    admin
      .from("task_participants")
      .select("task_id, assignee_id, role, created_at, accepted_at, done_at, declined_at")
      .eq("user_id", ownerId),
    admin
      .from("meetings")
      .select("id, created_by, date, status, moved_to_date")
      .eq("user_id", ownerId)
      .is("deleted_at", null),
    admin.from("meeting_participants").select("meeting_id, assignee_id, response").eq("user_id", ownerId),
    admin.from("ideas").select("id, created_by, created_at").eq("user_id", ownerId).is("deleted_at", null),
    admin.from("idea_recipients").select("idea_id, assignee_id").eq("user_id", ownerId),
  ]);

  const nameById = new Map<string, string>();
  let ownerName = "";
  for (const a of (people.data || []) as { id: string; name: string }[]) {
    nameById.set(a.id, withoutSelfMark(a.name));
    if (isSelfAssignee(a.name)) ownerName = withoutSelfMark(a.name);
  }
  const byLogin = new Map<string, string>();
  for (const m of (members.data || []) as { member_id: string | null; assignee_id: string }[]) {
    if (m.member_id) byLogin.set(m.member_id, nameById.get(m.assignee_id) || "");
  }
  // created_by пуст у всего, что завёл владелец (колонка моложе его строк),
  // и равен его id у того, что он заводил позже, — оба значат «он».
  const author = (createdBy: string | null) =>
    (!createdBy || createdBy === ownerId ? ownerName : byLogin.get(createdBy)) || UNKNOWN;

  const byMeeting = new Map<string, string[]>();
  for (const r of (mparts.data || []) as { meeting_id: string; assignee_id: string; response: string }[]) {
    // Отказавшийся на встрече не был — и в пару с организатором не идёт.
    if (r.response === "no") continue;
    const n = nameById.get(r.assignee_id);
    if (!n) continue;
    byMeeting.set(r.meeting_id, [...(byMeeting.get(r.meeting_id) || []), n]);
  }
  const byIdea = new Map<string, string[]>();
  for (const r of (recips.data || []) as { idea_id: string; assignee_id: string }[]) {
    const n = nameById.get(r.assignee_id);
    if (n) byIdea.set(r.idea_id, [...(byIdea.get(r.idea_id) || []), n]);
  }

  type TaskRow = {
    id: string;
    title: string;
    created_by: string | null;
    created_at: string;
    updated_at: string | null;
    status: string | null;
    deadline: string | null;
    completed_at: string | null;
  };
  type PartRow = {
    task_id: string;
    assignee_id: string;
    role: string;
    created_at: string;
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
  };
  type MeetingRow = { id: string; created_by: string | null; date: string; status: string; moved_to_date: string | null };
  type IdeaRow = { id: string; created_by: string | null; created_at: string };

  return {
    people: [...nameById.values()].filter(Boolean),
    tasks: ((tasks.data || []) as TaskRow[]).map((t) => ({
      id: t.id,
      title: t.title,
      author: author(t.created_by),
      createdAt: t.created_at,
      updatedAt: t.updated_at || t.created_at,
      status: t.status || "in_progress",
      deadline: t.deadline || "",
      completedAt: t.completed_at,
    })),
    parts: ((parts.data || []) as PartRow[])
      .map((p) => ({
        taskId: p.task_id,
        person: nameById.get(p.assignee_id) || "",
        role: p.role,
        createdAt: p.created_at,
        acceptedAt: p.accepted_at,
        doneAt: p.done_at,
        declinedAt: p.declined_at,
      }))
      .filter((p) => p.person),
    meetings: ((meetings.data || []) as MeetingRow[]).map((m) => ({
      id: m.id,
      author: author(m.created_by),
      date: m.date,
      status: m.status,
      movedToDate: m.moved_to_date,
      people: byMeeting.get(m.id) || [],
    })),
    ideas: ((ideas.data || []) as IdeaRow[]).map((i) => ({
      id: i.id,
      author: author(i.created_by),
      createdAt: i.created_at,
      recipients: byIdea.get(i.id) || [],
    })),
  };
}
