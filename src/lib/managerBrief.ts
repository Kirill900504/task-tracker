import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDate } from "@/lib/taskDisplay";
import { withoutSelfMark } from "@/lib/actorName";
import { numbered } from "@/lib/taskRef";
import { selfTaskIds } from "@/lib/selfTaskServer";

// Утренняя сводка руководителю — та же услуга, что владелец получает с
// самого начала, только про его собственные дела.
//
// Написана кодом, без модели. У владельца сводку переписывает GigaChat,
// потому что у него их десятки и связный текст экономит внимание; здесь
// строк три-четыре, и цена ошибки другая: человек, которому написали
// «просрочено две», в тот же день скажет об этом на планёрке. Факт дешевле
// формулировки.

export type ManagerBriefFacts = {
  name: string;
  overdue: { title: string; deadline: string }[];
  today: { title: string; deadline: string }[];
  // Сроки ДО следующей сводки (lib/briefDays): сводка выходит по
  // понедельникам и средам, и предупредить о сроке во вторник или в
  // пятницу можно только заранее. Это вместо отдельного «завтра срок»
  // каждый день — строкой в письме, которое и так приходит (07.10.2026).
  soon: { title: string; deadline: string }[];
  unanswered: { title: string }[];
  meetings: { title: string; time: string }[];
  returned: { title: string; comment: string }[];
  // Где со вчера что-то писали без него. Первое сообщение разговора уходит
  // сразу (см. commentDelivery), остальные копятся и приходят сюда — иначе
  // четырнадцать переписок превращают мессенджер в ленту, которую
  // перестают читать вместе со «сделал» и «не могу».
  discussed: { title: string }[];
  // Что сделали НАПАРНИКИ по общим задачам.
  //
  // Всё, что происходит с задачей, адресовано постановщику: отчитался,
  // отказался, просит перенос. Между тем «отчитались все» считается по
  // исполнителям, то есть отказ одного напрямую касается второго — он
  // ждёт закрытия задачи, которого не будет. Сообщением это слать нельзя
  // («если таким сплошняком инфа будет переть, я офигею это всё читать»):
  // задача на четверых дала бы каждому по три уведомления о чужих
  // ответах. Строкой в сводке — можно: она приходит раз в день и только
  // когда есть о чём.
  together: { title: string; note: string }[];
};

// Сводка уходит, только когда ГОРИТ срок: что-то просрочено, срок сегодня
// или до следующей сводки. 28.10.2026, его слова: «только по утрам и
// только если подходит срок выполнения или уже просроченные есть».
// Остальное (ответы, встречи, обсуждения) едет в ней попутно, но само по
// себе утреннего сообщения не стоит — у него своя доставка.
export function managerBriefIsEmpty(f: ManagerBriefFacts): boolean {
  return !f.overdue.length && !f.today.length && !f.soon.length;
}

export async function buildManagerBrief(
  admin: SupabaseClient,
  ownerId: string,
  assignee: { id: string; name: string },
  today: string,
  // До какого дня включительно показывать ближайшие сроки. Пусто — блока
  // нет (так сводка и строилась до 07.10.2026).
  soonUntil = "",
): Promise<ManagerBriefFacts> {
  const facts: ManagerBriefFacts = {
    // Без «(я)»: «Доброе утро, Кирилл Кучеренко (я)» — 28.10.2026.
    name: withoutSelfMark(assignee.name),
    overdue: [],
    today: [],
    soon: [],
    unanswered: [],
    meetings: [],
    returned: [],
    discussed: [],
    together: [],
  };

  const { data: rows } = await admin
    .from("task_participants")
    .select("task_id, role, accepted_at, done_at, declined_at, tasks(title, number, deadline, status, recur, approval_state, approval_comment, deleted_at)")
    .eq("assignee_id", assignee.id)
    .eq("user_id", ownerId)
    .eq("role", "executor");

  type Row = {
    task_id: string;
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
    tasks: {
      title: string;
      number?: number | null;
      deadline: string | null;
      status: string | null;
      recur: string | null;
      approval_state: string | null;
      approval_comment: string | null;
      deleted_at: string | null;
    } | null;
  };

  // Закрытая задача в сводку не попадает НИ ОДНИМ блоком. 28.10.2026
  // Макарову пришло «Вместе с вами: #111 … пятеро отчитались» по задаче,
  // давно принятой, при пустом трекере: этот отбор стоял только у сроков,
  // а обсуждения и напарники брали все его строки участия подряд — и
  // повторяли одно и то же в каждой сводке навсегда.
  const isOpen = (t: Row["tasks"]): t is NonNullable<Row["tasks"]> =>
    !!t &&
    !t.deleted_at &&
    t.status !== "done" &&
    // Принятая разовая задача — закрыта, что бы ни стояло в status.
    !(t.approval_state === "accepted" && (t.recur || "none") === "none");

  // Личные задачи (поставил себе и работает один — lib/selfTaskServer) —
  // только сроками: просрочено, сегодня, скоро. 28.10.2026, его слова: «по
  // ним напоминать в ботах не надо, только по просроченным и по тем, по
  // которым подходит срок». «Ждут вашего ответа» про задачу, которую он сам
  // себе записал, — это бот, спрашивающий человека, принял ли он свою же
  // заметку; ответов, возврата и напарников у неё не бывает.
  const openRows = ((rows || []) as unknown as Row[]).filter((r) => isOpen(r.tasks));
  const personal = await selfTaskIds(admin, ownerId, openRows.map((r) => r.task_id));

  for (const r of openRows) {
    const t = r.tasks!;
    if (r.done_at) continue;
    const self = personal.has(r.task_id);
    // У повтора в колонке deadline лежит срок ПЕРВОГО круга, и «срок был
    // 24.09» через неделю — неправда: повтор просроченным не бывает, так
    // же как в трекере (isOverdue в taskDisplay и taskLogic). Отзыв
    // Витовского 25.09.2026 — закрытая ежедневная задача в «Просрочено».
    const recurring = (t.recur || "none") !== "none";
    const deadline = t.deadline || "";
    if (!self && t.approval_state === "returned") facts.returned.push({ title: numbered(t), comment: t.approval_comment || "" });
    if (!recurring && deadline && deadline < today) facts.overdue.push({ title: numbered(t), deadline });
    else if (!recurring && deadline === today) facts.today.push({ title: numbered(t), deadline });
    else if (!recurring && deadline && soonUntil && deadline > today && deadline <= soonUntil) facts.soon.push({ title: numbered(t), deadline });
    if (!self && !r.accepted_at && !r.declined_at) facts.unanswered.push({ title: numbered(t) });
  }

  const { data: meetings } = await admin
    .from("meetings")
    .select("title, time, participants, status")
    .eq("user_id", ownerId)
    .eq("date", today)
    .is("deleted_at", null);

  for (const m of ((meetings || []) as { title: string; time: string; participants: string[]; status: string }[])) {
    if (m.status !== "planned") continue;
    if (!(m.participants || []).includes(assignee.name)) continue;
    facts.meetings.push({ title: m.title, time: m.time || "" });
  }
  facts.meetings.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

  // Обсуждения, в которых со вчера писали другие. Своих сообщений здесь
  // быть не должно: сводка, напоминающая человеку о том, что он сам вчера
  // написал, учит пролистывать сводку.
  const open = openRows.filter((r) => !personal.has(r.task_id));
  const mine = open.map((r) => r.task_id);
  // Напарники — только там, где задача ещё ждёт ЕГО ответа: «сосед
  // отчитался» значит «дело за вами», а если он сам уже отчитался или
  // отказался, строка ничего от него не просит.
  const waitingOnMe = new Set(open.filter((r) => !r.done_at && !r.declined_at).map((r) => r.task_id));
  if (mine.length) {
    const since = new Date(Date.parse(today + "T00:00:00Z") - 24 * 60 * 60 * 1000).toISOString();
    const { data: comments } = await admin
      .from("item_comments")
      .select("item_id, author_assignee_id")
      .eq("item_kind", "task")
      .eq("user_id", ownerId)
      .in("item_id", mine)
      .gt("created_at", since)
      .is("deleted_at", null)
      .eq("system", false);

    const others = [
      ...new Set(
        ((comments || []) as { item_id: string; author_assignee_id: string | null }[])
          .filter((c) => c.author_assignee_id !== assignee.id)
          .map((c) => c.item_id),
      ),
    ];
    const titleOf = new Map(
      open.map((r) => [r.task_id, numbered(r.tasks!)]),
    );
    for (const id of others) {
      const title = titleOf.get(id);
      if (title) facts.discussed.push({ title });
    }

    // Напарники по тем же задачам. Спрашивается это одним запросом по уже
    // собранному списку задач: строк участия у четырнадцати человек много,
    // а задач у одного — единицы.
    const { data: mates } = await admin
      .from("task_participants")
      .select("task_id, assignee_id, done_at, declined_at, assignees(name, archived_at)")
      .eq("user_id", ownerId)
      .eq("role", "executor")
      .in("task_id", mine);

    type Mate = {
      task_id: string;
      assignee_id: string;
      done_at: string | null;
      declined_at: string | null;
      assignees: { name: string; archived_at: string | null } | { name: string; archived_at: string | null }[] | null;
    };
    const byTask = new Map<string, string[]>();
    for (const m of ((mates || []) as unknown as Mate[])) {
      if (m.assignee_id === assignee.id || !waitingOnMe.has(m.task_id)) continue;
      // Убранного из команды здесь нет: «Кирилл (тест) отчитался» через
      // неделю после того, как его убрали, — новость о человеке, которого
      // уже нет (28.10.2026).
      const person = Array.isArray(m.assignees) ? m.assignees[0] : m.assignees;
      if (person?.archived_at) continue;
      // Только то, что человек СКАЗАЛ. «Ещё не ответил» сюда не идёт: это
      // не событие, а тишина, и о ней спрашивает постановщик, а не сосед.
      const name = withoutSelfMark((Array.isArray(m.assignees) ? m.assignees[0]?.name : m.assignees?.name) || "");
      const said = m.declined_at ? `${name} не может` : m.done_at ? `${name} отчитался` : "";
      if (!name || !said) continue;
      byTask.set(m.task_id, [...(byTask.get(m.task_id) || []), said]);
    }
    for (const [taskId, notes] of byTask) {
      const title = titleOf.get(taskId);
      if (title) facts.together.push({ title, note: notes.join("; ") });
    }
  }

  return facts;
}

export function composeManagerBrief(f: ManagerBriefFacts): string {
  const lines = [`Доброе утро, ${f.name}.`];

  // Порядок продиктован тем, что человек должен сделать раньше: сначала
  // то, что уже горит, потом сегодняшнее, потом то, где ждут его ответа.
  if (f.overdue.length) {
    lines.push("", "⚠ Просрочено:");
    for (const t of f.overdue) lines.push(`• ${t.title} — срок был ${fmtDate(t.deadline)}`);
  }
  if (f.today.length) {
    lines.push("", "Сегодня:");
    for (const t of f.today) lines.push(`• ${t.title}`);
  }
  if (f.soon.length) {
    lines.push("", "⏳ Скоро срок:");
    for (const t of [...f.soon].sort((a, b) => a.deadline.localeCompare(b.deadline))) lines.push(`• ${t.title} — до ${fmtDate(t.deadline)}`);
  }
  if (f.returned.length) {
    lines.push("", "Вернули на доработку:");
    for (const t of f.returned) lines.push(`• ${t.title}${t.comment ? " — " + t.comment : ""}`);
  }
  if (f.unanswered.length) {
    lines.push("", "Ждут вашего ответа:");
    for (const t of f.unanswered) lines.push(`• ${t.title}`);
  }
  if (f.meetings.length) {
    lines.push("", "Встречи сегодня:");
    for (const m of f.meetings) lines.push(`• ${m.time ? m.time + " — " : ""}${m.title}`);
  }
  // Общие задачи — перед обсуждениями: это ещё про работу, а не про
  // чтение. «Отчитался» соседа означает, что задача ждёт одного вас.
  if (f.together.length) {
    lines.push("", "Вместе с вами:");
    for (const t of f.together) lines.push(`• ${t.title} — ${t.note}`);
  }
  // Последним: это не то, что нужно сделать, а то, что стоит прочитать.
  if (f.discussed.length) {
    lines.push("", "💬 Писали в обсуждениях:");
    for (const t of f.discussed) lines.push(`• ${t.title}`);
  }

  return lines.join("\n");
}
