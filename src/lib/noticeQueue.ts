import type { SupabaseClient } from "@supabase/supabase-js";

// Одно письмо вместо десяти сообщений.
//
// Кирилл показал снимок своей переписки с ботом: шесть сообщений подряд,
// каждое про своё, каждое в две-три строки. «Если таким сплошняком инфа
// будет переть, я офигею это всё читать и элементарно не смогу нормально
// воспринимать». Людей четырнадцать, и каждый за день нажимает «принял»,
// «сделал», «не могу» и что-нибудь пишет.
//
// Здесь — сборка такого письма. Событие кладётся в очередь тремя полями
// (что за задача, кто, какими словами), а заголовок группы пишется в момент
// отправки: склеенную заранее строку пришлось бы разбирать обратно, чтобы
// сложить её с соседней.
//
// Порядок групп — не алфавитный и не по времени, а по тому, что требует
// решения раньше. Сверху то, где ждут ЕГО (приёмка, отказ, просьба о
// переносе), ниже то, что просто сообщает (принял, написал). Это и есть вся
// разница между сводкой и лентой.

export type NoticeKind =
  | "reported"
  | "reported_all"
  | "declined"
  | "reschedule"
  | "accepted"
  | "vote_yes"
  | "vote_no"
  | "vote_late"
  | "idea_taken"
  | "comment"
  | "other";

export type Notice = {
  kind: NoticeKind;
  // Задача или встреча, о которой речь.
  item?: string;
  who?: string;
  what?: string;
};

type QueuedRow = { kind: string; item: string; who: string; what: string };

// Заголовок группы и её место в письме. Порядок массива и есть порядок в
// сообщении.
const GROUPS: { kind: NoticeKind; title: (n: number) => string }[] = [
  { kind: "reported_all", title: (n) => `🔍 Ждут вашей приёмки (${n})` },
  { kind: "declined", title: (n) => `⛔ Не могут выполнить (${n})` },
  { kind: "reschedule", title: (n) => `📅 Просят перенести срок (${n})` },
  { kind: "reported", title: (n) => `🏁 Отчитались о своей части (${n})` },
  { kind: "vote_no", title: (n) => `❌ Не придут на встречу (${n})` },
  { kind: "vote_late", title: (n) => `🕐 Опоздают на встречу (${n})` },
  { kind: "accepted", title: (n) => `✅ Приняли в работу (${n})` },
  { kind: "vote_yes", title: (n) => `👍 Придут на встречу (${n})` },
  { kind: "idea_taken", title: (n) => `➕ Взяли мысль в работу (${n})` },
  { kind: "comment", title: (n) => `💬 Написали в обсуждении (${n})` },
  { kind: "other", title: (n) => `📌 Ещё (${n})` },
];

// Виды, которые говорят о задаче и теряют смысл, когда она закрыта.
const TASK_KINDS = new Set<string>(["reported_all", "declined", "reschedule", "reported", "accepted"]);

// Строка внутри группы: сначала человек, потом задача, потом его слова.
// Человек первым потому, что группа уже сказала, ЧТО произошло, и читается
// это как список фамилий — по нему и ищут глазами.
function line(row: QueuedRow): string {
  const who = row.who || "Кто-то";
  const item = row.item ? ` — «${row.item}»` : "";
  const what = row.what ? `: ${row.what}` : "";
  return `• ${who}${item}${what}`;
}

// Сколько строк показывать в одной группе. Дальше читают уже не список, а
// стену; остаток называется числом и лежит в трекере.
const PER_GROUP = 6;

export function composeDigest(rows: QueuedRow[]): string {
  if (!rows.length) return "";

  // Одно событие — письма не надо: заголовок «1 событие» и одна строка под
  // ним читаются хуже, чем просто эта строка.
  if (rows.length === 1) {
    const only = rows[0];
    const group = GROUPS.find((g) => g.kind === only.kind) || GROUPS[GROUPS.length - 1];
    return group.title(1).replace(/ \(1\)$/, "") + "\n" + line(only);
  }

  const byKind = new Map<string, QueuedRow[]>();
  for (const r of rows) {
    const list = byKind.get(r.kind);
    if (list) list.push(r);
    else byKind.set(r.kind, [r]);
  }

  const out: string[] = [`📋 РОКАС · ${rows.length} ${plural(rows.length)}`];
  for (const group of GROUPS) {
    const list = byKind.get(group.kind);
    if (!list?.length) continue;
    out.push("", group.title(list.length));
    for (const row of list.slice(0, PER_GROUP)) out.push(line(row));
    if (list.length > PER_GROUP) out.push(`  …и ещё ${list.length - PER_GROUP}`);
  }
  return out.join("\n");
}

function plural(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return "событие";
  if (!teen && last >= 2 && last <= 4) return "события";
  return "событий";
}

// Разобрать очередь: каждому адресату — по одному письму.
//
// Вызывается кроном, который и так ходит каждые несколько минут. Строки
// помечаются отправленными ДО отправки: письмо, не дошедшее из-за сети, —
// это одно потерянное письмо, а строка, оставшаяся неотмеченной, — вечный
// повтор одного и того же каждые пять минут.
export async function flushNotices(
  admin: SupabaseClient,
  send: (userId: string, toUser: string | null, text: string) => Promise<void>,
): Promise<number> {
  const { data, error } = await admin
    .from("notification_queue")
    .select("id, user_id, to_user, kind, item, who, what")
    .is("sent_at", null)
    .order("created_at")
    .limit(500);
  if (error || !data?.length) return 0;

  type Row = QueuedRow & { id: string; user_id: string; to_user: string | null };
  const rows = data as Row[];

  // Ключ — пространство плюс адресат: у владельца и у руководителя в одном
  // пространстве события разные, и складывать их в одно письмо нельзя.
  //
  // Разделитель написан escape-последовательностью, а не самим нулевым
  // байтом: байт в исходнике делает файл двоичным для grep и ripgrep, и
  // поиск по проекту молча перестаёт его видеть. Найдено сквозной
  // диагностикой 20.09.2026 — поиском, который этот файл пропустил.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.user_id}\u0000${r.to_user || ""}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  await admin
    .from("notification_queue")
    .update({ sent_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  // Что к минуте отправки уже решено — в письмо не идёт. Отзыв Витовского
  // 25.09.2026: «я тут суету наводил, задачи закрывал, а потом через какое-
  // то время пришла сводка» — с «ждут приёмки» и «просят перенести» по
  // задачам, которые он уже принял. Письмо, требующее решений, которые
  // приняты, учит его не читать.
  const resolved = await resolvedTitles(admin, rows);

  let sent = 0;
  for (const raw of groups.values()) {
    const list = raw.filter((r) => !(TASK_KINDS.has(r.kind) && resolved.has(`${r.user_id} ${r.item}`)));
    const text = composeDigest(list);
    if (!text) continue;
    try {
      await send(list[0].user_id, list[0].to_user, text);
      sent++;
    } catch (e) {
      console.error("notice flush:", e instanceof Error ? e.message : String(e));
    }
  }
  return sent;
}

// Названия задач, которые к этой минуте закрыты, — по пространствам.
//
// В очереди лежит название, а не идентификатор (событие кладётся тремя
// полями — так задумано, см. начало файла), поэтому и сверяется название.
// Закрытой считается строка, только если закрыты ВСЕ задачи пространства с
// этим названием: «Отчёт» бывает у двоих, и выкинуть живое событие из-за
// чужой закрытой задачи хуже, чем показать одно лишнее.
async function resolvedTitles(admin: SupabaseClient, rows: (QueuedRow & { user_id: string })[]): Promise<Set<string>> {
  const out = new Set<string>();
  const bySpace = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!TASK_KINDS.has(r.kind) || !r.item) continue;
    const set = bySpace.get(r.user_id) || new Set<string>();
    set.add(r.item);
    bySpace.set(r.user_id, set);
  }
  for (const [space, titles] of bySpace) {
    const { data, error } = await admin
      .from("tasks")
      .select("title, status, approval_state, recur, deleted_at")
      .eq("user_id", space)
      .in("title", [...titles]);
    // Не смогли спросить — отправляем как есть: лишняя строка дешевле
    // потерянной.
    if (error || !data) continue;
    const open = new Set<string>();
    const seen = new Set<string>();
    for (const t of data as { title: string; status: string | null; approval_state: string | null; recur: string | null; deleted_at: string | null }[]) {
      seen.add(t.title);
      const closed = !!t.deleted_at || t.status === "done" || (t.approval_state === "accepted" && (t.recur || "none") === "none");
      if (!closed) open.add(t.title);
    }
    for (const title of seen) if (!open.has(title)) out.add(`${space} ${title}`);
  }
  return out;
}

// Положить событие в очередь.
//
// Молча: уведомление — это польза, а не обязанность, и уронить отчёт
// человека из-за того, что не записалась строка о нём, было бы обменом
// наоборот. Таблицы может ещё не быть (миграция не применена) — тогда
// вызывающий увидит false и отправит по-старому, одним сообщением.
export async function queueNotice(
  admin: SupabaseClient,
  userId: string,
  toUser: string | null,
  notice: Notice,
): Promise<boolean> {
  const { error } = await admin.from("notification_queue").insert({
    user_id: userId,
    to_user: toUser,
    kind: notice.kind,
    item: notice.item || "",
    who: notice.who || "",
    what: notice.what || "",
  });
  if (error) {
    console.error("notice queue:", error.message);
    return false;
  }
  return true;
}
