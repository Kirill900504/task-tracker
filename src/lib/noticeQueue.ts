import type { SupabaseClient } from "@supabase/supabase-js";
import { taskRef } from "@/lib/taskRef";

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
//
// И одна строка на одного человека по одной задаче (14.10.2026). Снимок
// Кирилла: «не может выполнить» и ниже «написали в обсуждении» — тот же
// человек, та же задача с названием в десять строк, дважды. «Зачем ты ниже
// ещё добавляешь НАПИСАЛИ В ОБСУЖДЕНИИ… бред». Он прав: группа отвечает на
// вопрос «что произошло», а у одного человека с одной задачей за пять
// минут произошло одно — он ответил. Его реплика в обсуждении той же
// задачи — часть ответа, а не второе событие (см. foldNotices).

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
  // Её идентификатор и номер (миграция 0054): по первому события одного
  // человека склеиваются в строку, второй показывается в письме.
  itemId?: string | null;
  num?: number | null;
  who?: string;
  what?: string;
};

export type QueuedRow = { kind: string; item: string; who: string; what: string; item_id?: string | null; item_number?: number | null };

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

// Ответы на задачу и на встречу — «семьи»: у одного человека по одному
// делу в письме остаётся ПОСЛЕДНИЙ ответ из семьи. «Принял», а потом «не
// могу» — это «не могу»; «не могу» кнопкой и следом причина текстом (бот
// спрашивает её вторым сообщением) — это одно «не могу» с причиной, а не
// две строки, из которых первая пустая.
const TASK_ANSWERS = TASK_KINDS;
const VOTES = new Set<string>(["vote_yes", "vote_late", "vote_no"]);

// События, по которым постановщику делать нечего: человек принял задачу,
// придёт на встречу, взял мысль. Отдельным письмом они не уходят НИКОГДА —
// только попутчиками письма, в котором есть что решать. Крон разбирает
// очередь каждые пять минут, и до 13.10.2026 одно «Евгений принял в работу»
// было целым сообщением в мессенджере через пять минут после нажатия, а
// заодно и окном на ПК (lib/desktopAlerts). Кирилл, по отзыву Витковского:
// «они должны быть адресные и по важным моментам, а не спамом сыпаться».
// Попутчика, так и не дождавшегося письма, через сутки снимают молча: на
// доске это давно видно, а вчерашнее «принял» в сегодняшней сводке — шум.
export const QUIET_KINDS = new Set<string>(["accepted", "vote_yes", "idea_taken"]);
const QUIET_HOLD_MS = 24 * 60 * 60 * 1000;

// Что из группы одного адресата уходит сейчас, а что снимается без письма.
// Остальное ждёт следующего прогона.
export function planFlush<T extends { kind: string; created_at: string }>(list: T[], now: number): { send: T[]; drop: T[] } {
  if (list.some((r) => !QUIET_KINDS.has(r.kind))) return { send: list, drop: [] };
  return { send: [], drop: list.filter((r) => now - new Date(r.created_at).getTime() > QUIET_HOLD_MS) };
}

// Строка письма: событие плюс то, что тот же человек написал о том же деле.
export type DigestEntry = QueuedRow & { notes: string[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Подпись к документам, приложенным к ответу (lib/answerFiles): «Документы к
// отказу». Как реплика она ничего не говорит — говорит то, что файлы есть.
const isFilesLabel = (text: string) => /^Документы к /.test(text.trim());

// Склеить очередь одного адресата в строки письма.
//
// Ключ — дело плюс человек: по идентификатору, а у строк, положенных до
// миграции 0054, по названию. Правила три, и каждое — ответ на дубль,
// который был виден в сводке.
// 1. Ответы одной семьи (задача / встреча) схлопываются в последний. Его
//    слова берутся из последнего ответа, где они есть; «отчитались все»
//    сильнее «отчитался о своей части» — второе пишется в бот причиной к
//    первому и иначе стёрло бы признак, что работа ждёт приёмки.
// 2. Реплика в обсуждении того же дела тем же человеком приклеивается к его
//    ответу и пропадает вовсе, если повторяет его слова.
// 3. Несколько реплик одного человека в одном обсуждении — одна строка.
export function foldNotices(rows: QueuedRow[]): DigestEntry[] {
  const key = (r: QueuedRow) => `${r.item_id || r.item}\u0000${r.who}`;
  const answers = new Map<string, DigestEntry>();
  const out: DigestEntry[] = [];

  for (const r of rows) {
    const family = TASK_ANSWERS.has(r.kind) ? "task" : VOTES.has(r.kind) ? "vote" : null;
    if (!family) continue;
    const k = `${family}\u0000${key(r)}`;
    const prev = answers.get(k);
    if (!prev) {
      const entry = { ...r, notes: [] };
      answers.set(k, entry);
      out.push(entry);
      continue;
    }
    const wasAll = prev.kind === "reported_all";
    const keptWhat = prev.what;
    Object.assign(prev, r, { notes: prev.notes });
    if (!prev.what.trim()) prev.what = keptWhat;
    if (wasAll && prev.kind === "reported") prev.kind = "reported_all";
  }

  // Ответ человека по делу — независимо от семьи: реплика по встрече
  // клеится к его «не смогу», по задаче — к «не могу».
  const answerOf = new Map<string, DigestEntry>();
  for (const [k, entry] of answers) answerOf.set(k.slice(k.indexOf("\u0000") + 1), entry);

  const comments = new Map<string, DigestEntry>();
  for (const r of rows) {
    if (TASK_ANSWERS.has(r.kind) || VOTES.has(r.kind)) continue;
    if (r.kind !== "comment") {
      out.push({ ...r, notes: [] });
      continue;
    }
    const text = isFilesLabel(r.what) ? "📎 приложены документы" : r.what.trim();
    const answer = answerOf.get(key(r));
    const host = answer || comments.get(key(r));
    if (!host) {
      const entry = { ...r, what: text, notes: [] };
      comments.set(key(r), entry);
      out.push(entry);
      continue;
    }
    if (!text || same(text, host.what) || host.notes.some((n) => same(n, text))) continue;
    if (answer && host.what && host.what.toLowerCase().includes(text.toLowerCase())) continue;
    host.notes.push(text);
  }
  return out;
}

// Дальше трёх строк ответ превращается в переписку, а её место — в
// обсуждении; в письме — ровно чтобы понять, о чём речь.
const WHAT_LIMIT = 300;
const TITLE_LIMIT = 70;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// Строка внутри группы: сначала человек, потом задача, потом его слова.
// Человек первым потому, что группа уже сказала, ЧТО произошло, и читается
// это как список фамилий — по нему и ищут глазами. Задача — номером и
// коротким названием: номер одинаков в трекере и в боте, а название в
// десять строк превращало сводку из двух событий в экран текста.
function line(entry: DigestEntry): string {
  const who = entry.who || "Кто-то";
  const item = entry.item ? ` — ${taskRef({ title: entry.item, number: entry.item_number }, TITLE_LIMIT)}` : "";
  const what = entry.what ? `: ${clip(entry.what, WHAT_LIMIT)}` : "";
  // У документов свой значок, и «💬 📎» подряд читалось как два события.
  const notes = entry.notes.map((n) => `\n   ${n.startsWith("📎") ? "" : "💬 "}${clip(n, WHAT_LIMIT)}`).join("");
  return `• ${who}${item}${what}${notes}`;
}

// Сколько строк показывать в одной группе. Дальше читают уже не список, а
// стену; остаток называется числом и лежит в трекере.
const PER_GROUP = 6;

export function composeDigest(rows: QueuedRow[]): string {
  const entries = foldNotices(rows);
  if (!entries.length) return "";

  // Одно событие — письма не надо: заголовок «1 событие» и одна строка под
  // ним читаются хуже, чем просто эта строка.
  if (entries.length === 1) {
    const only = entries[0];
    const group = GROUPS.find((g) => g.kind === only.kind) || GROUPS[GROUPS.length - 1];
    return group.title(1).replace(/ \(1\)$/, "") + "\n" + line(only);
  }

  const byKind = new Map<string, DigestEntry[]>();
  for (const r of entries) {
    const list = byKind.get(r.kind);
    if (list) list.push(r);
    else byKind.set(r.kind, [r]);
  }

  const out: string[] = [`📋 РОКАС · ${entries.length} ${plural(entries.length)}`];
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

// Ключ «закрыта ли задача»: по идентификатору, а у строк до миграции 0054 —
// по пространству и названию (см. resolvedTasks).
const resolvedKey = (r: QueuedRow & { user_id: string }) => (r.item_id ? `id\u0000${r.item_id}` : `${r.user_id}\u0000${r.item}`);

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
    .select("id, user_id, to_user, kind, item, item_id, item_number, who, what, created_at")
    .is("sent_at", null)
    .order("created_at")
    .limit(500);
  if (error || !data?.length) return 0;

  type Row = QueuedRow & { id: string; user_id: string; to_user: string | null; created_at: string };
  const rows = data as Row[];

  // Ключ — пространство плюс адресат: у владельца и у руководителя в одном
  // пространстве события разные, и складывать их в одно письмо нельзя.
  //
  // Разделитель написан escape-последовательностью, а не самим нулевым
  // байтом: байт в исходнике делает файл двоичным для grep и ripgrep, и
  // поиск по проекту молча перестаёт его видеть. Найдено сквозной
  // диагностикой 20.09.2026 — поиском, который этот файл пропустил. И
  // найдено ещё раз 14.10.2026: два байта оставались ниже, в сверке
  // закрытых задач, и файл по-прежнему читался как двоичный.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.user_id}\u0000${r.to_user || ""}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const now = Date.now();
  const outgoing: Row[][] = [];
  const done: string[] = [];
  for (const list of groups.values()) {
    const { send, drop } = planFlush(list, now);
    if (send.length) outgoing.push(send);
    for (const r of [...send, ...drop]) done.push(r.id);
  }
  if (!done.length) return 0;
  await admin.from("notification_queue").update({ sent_at: new Date().toISOString() }).in("id", done);

  // Что к минуте отправки уже решено — в письмо не идёт. Отзыв Витовского
  // 25.09.2026: «я тут суету наводил, задачи закрывал, а потом через какое-
  // то время пришла сводка» — с «ждут приёмки» и «просят перенести» по
  // задачам, которые он уже принял. Письмо, требующее решений, которые
  // приняты, учит его не читать.
  const resolved = await resolvedTasks(admin, outgoing.flat());

  let sent = 0;
  for (const raw of outgoing) {
    const list = raw.filter((r) => !(TASK_KINDS.has(r.kind) && resolved.has(resolvedKey(r))));
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

type TaskState = { id?: string; title: string; status: string | null; approval_state: string | null; recur: string | null; deleted_at: string | null };
const isClosed = (t: TaskState) => !!t.deleted_at || t.status === "done" || (t.approval_state === "accepted" && (t.recur || "none") === "none");

// Задачи, которые к этой минуте закрыты.
//
// С миграции 0054 событие несёт идентификатор задачи, и сверяется она сама.
// Строки, положенные раньше, несут только название: такая считается
// закрытой, только если закрыты ВСЕ задачи пространства с этим названием —
// «Отчёт» бывает у двоих, и выкинуть живое событие из-за чужой закрытой
// задачи хуже, чем показать одно лишнее.
async function resolvedTasks(admin: SupabaseClient, rows: (QueuedRow & { user_id: string })[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = new Set<string>();
  const bySpace = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!TASK_KINDS.has(r.kind)) continue;
    if (r.item_id) {
      ids.add(r.item_id);
      continue;
    }
    if (!r.item) continue;
    const set = bySpace.get(r.user_id) || new Set<string>();
    set.add(r.item);
    bySpace.set(r.user_id, set);
  }

  // Не смогли спросить — отправляем как есть: лишняя строка дешевле
  // потерянной.
  if (ids.size) {
    const { data } = await admin.from("tasks").select("id, title, status, approval_state, recur, deleted_at").in("id", [...ids]);
    for (const t of (data || []) as TaskState[]) if (isClosed(t)) out.add(`id\u0000${t.id}`);
  }

  for (const [space, titles] of bySpace) {
    const { data, error } = await admin
      .from("tasks")
      .select("title, status, approval_state, recur, deleted_at")
      .eq("user_id", space)
      .in("title", [...titles]);
    if (error || !data) continue;
    const open = new Set<string>();
    const seen = new Set<string>();
    for (const t of data as TaskState[]) {
      seen.add(t.title);
      if (!isClosed(t)) open.add(t.title);
    }
    for (const title of seen) if (!open.has(title)) out.add(`${space}\u0000${title}`);
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
    item_id: notice.itemId || null,
    item_number: notice.num ?? null,
    who: notice.who || "",
    what: notice.what || "",
  });
  if (error) {
    console.error("notice queue:", error.message);
    return false;
  }
  return true;
}
