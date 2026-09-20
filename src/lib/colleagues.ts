import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig } from "@/lib/botTransport";
import { BOT_CHANNELS } from "@/lib/botTransport";
import { fmtDate } from "@/lib/taskDisplay";

// Sending an item to the person it is addressed to, and understanding what
// they press in reply.
//
// A colleague is a row in `assignees` with a messenger chat attached — not
// a user of the tracker. They never sign in, own nothing, and see only what
// is sent to them. Telegram or MAX makes no difference here: the same row
// can carry either, or both. Everything they are allowed to do is checked here against
// the item itself: the button carries an id, and the id has to belong to an
// item addressed to that very chat.

export type ColleagueRow = {
  id: string;
  name: string;
  telegram_chat_id: number | null;
  max_user_id: number | null;
};

export type SendKind = "task" | "meeting" | "idea";

// Ответить ровно в это обсуждение.
//
// Без этой кнопки написанное коллегой уходило в «самую свежую открытую
// задачу» — угадывание, о котором бот честно говорил вслух, и всё равно
// запись оказывалась не в той истории. Кнопка стоит под каждым сообщением
// обсуждения и под самой задачей: ответ адресуется тем же нажатием,
// которым его читают.
export function replyButtons(kind: "task" | "meeting", itemId: string): BotButton[][] {
  return [[{ text: "💬 Ответить", data: encodeCallback(kind, "msg", itemId) }]];
}

// Кто это нажал и что именно — упаковано в данные кнопки, у которых
// Telegram ограничивает длину 64 байтами, поэтому только вид, действие и id.
export type CallbackAction = { kind: SendKind; action: string; id: string };

export function encodeCallback(kind: SendKind, action: string, id: string): string {
  return `${kind[0]}:${action}:${id}`;
}

export function decodeCallback(data: string): CallbackAction | null {
  const parts = String(data || "").split(":");
  if (parts.length !== 3) return null;
  const kindLetter = parts[0];
  const kind = kindLetter === "t" ? "task" : kindLetter === "m" ? "meeting" : kindLetter === "i" ? "idea" : null;
  if (!kind || !parts[1] || !parts[2]) return null;
  return { kind, action: parts[1], id: parts[2] };
}

export function taskMessage(task: { title: string; description?: string; deadline?: string | null; priority?: string }, from: string): string {
  const lines = [`📋 Задача от ${from}:`, "", task.title];
  if (task.description) lines.push("", task.description);
  const bits: string[] = [];
  if (task.deadline) bits.push("срок: " + fmtDate(task.deadline));
  if (bits.length) lines.push("", bits.join(" · "));
  return lines.join("\n");
}

export function meetingMessage(
  meeting: { title: string; date: string; time?: string | null; participants?: string[] },
  from: string,
): string {
  const lines = [`📅 Встреча от ${from}:`, "", meeting.title, "", fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "")];
  const others = (meeting.participants || []).filter(Boolean);
  if (others.length > 1) lines.push("Участники: " + others.join(", "));
  return lines.join("\n");
}

export function ideaMessage(text: string, from: string): string {
  return `💡 Мысль от ${from}:\n\n${text}`;
}

// Три двери, а не две. «Принял» и «Сделал» описывают только тот случай,
// когда всё идёт хорошо; человеку, который не может, раньше оставалось
// молчать — а молчание и есть тот сбой, ради устранения которого всё это
// затевалось. Причина спрашивается следом, отдельным сообщением.
export function taskButtons(taskId: string, role: "executor" | "coexecutor" | "watcher" = "executor"): BotButton[][] {
  // Наблюдателя не спрашивают — его поставили знать, а не отвечать. Кнопка
  // «Сделал» у него означала бы отчёт, которого от него никто не ждёт, и
  // постановщик получил бы сообщение, будто работу сделал человек, которого
  // на неё не ставили. Но сказать слово он вправе: раньше сообщение
  // приходило к нему вовсе без кнопок, и ответить на него было нечем — при
  // том что обсуждение задачи наблюдатель видит целиком.
  if (role === "watcher") return replyButtons("task", taskId);
  // Соисполнителю «Сделал» не даётся: отчитываются только исполнители
  // (закрытие задачи считает именно их), а сообщение постановщику при этом
  // уходило со словами «выполнил свою часть» — то есть говорило о
  // продвижении, которого в задаче не происходило.
  if (role === "coexecutor") {
    return [
      [{ text: "✅ Принял", data: encodeCallback("task", "acc", taskId) }],
      [{ text: "💬 Ответить", data: encodeCallback("task", "msg", taskId) }],
    ];
  }
  return [
    [
      { text: "✅ Принял", data: encodeCallback("task", "acc", taskId) },
      { text: "🏁 Сделал", data: encodeCallback("task", "done", taskId) },
    ],
    [
      { text: "⛔ Не могу", data: encodeCallback("task", "no", taskId) },
      // Четвёртая дверь. В трекере она была с самого начала, в мессенджере
      // её не было — а четверо из шести в трекер не заходят вовсе, и выбор
      // у них стоял между «не могу» и молчанием. «Не могу» вместо «дайте
      // срок» — это отказ от работы, которую человек готов сделать, и
      // разницу между этими двумя ответами постановщик обязан видеть.
      { text: "📅 Прошу перенос", data: encodeCallback("task", "mv", taskId) },
    ],
    [{ text: "💬 Ответить", data: encodeCallback("task", "msg", taskId) }],
  ];
}

// На сколько переносим — кнопками, а не датой словами.
//
// Разобрать «до конца следующей недели» можно только моделью, а модель в
// этом трекере не считает и не решает фактов. Четыре срока закрывают почти
// всё, а если не подошло — человек напишет в причине («лучше до 25-го»):
// перенос он всё равно только ПРОСИТ, двигает срок постановщик, и точная
// дата здесь — предложение, а не решение.
export const RESCHEDULE_OPTIONS: { days: number; label: string }[] = [
  { days: 1, label: "на день" },
  { days: 3, label: "на 3 дня" },
  { days: 7, label: "на неделю" },
  { days: 14, label: "на 2 недели" },
];

export function rescheduleButtons(taskId: string): BotButton[][] {
  return [
    RESCHEDULE_OPTIONS.slice(0, 2).map((o) => ({ text: o.label, data: encodeCallback("task", "mv" + o.days, taskId) })),
    RESCHEDULE_OPTIONS.slice(2).map((o) => ({ text: o.label, data: encodeCallback("task", "mv" + o.days, taskId) })),
    [{ text: "← Отмена", data: encodeCallback("task", "show", taskId) }],
  ];
}

// «Не смогу» — не вежливость, а половина смысла: список подтвердивших не
// отличает того, кто не придёт, от того, кто просто не ответил, а
// организатору нужна именно эта разница. Причина спрашивается следом.
// Кнопки остаются и ПОСЛЕ ответа — «передумать можно до начала» это решение
// проекта, а сообщение, переписанное без кнопок, делало его недействующим:
// передумать было нечем, кроме как писать словами.
//
// «Опоздаю» стоит между «буду» и «не смогу» потому, что раньше человеку,
// задерживающемуся на двадцать минут, приходилось выбирать из двух неправд.
// На практике он жал «буду», и организатор узнавал о задержке в момент
// задержки.
export function meetingButtons(meetingId: string): BotButton[][] {
  return [
    [
      { text: "✅ Буду", data: encodeCallback("meeting", "yes", meetingId) },
      { text: "🕐 Опоздаю", data: encodeCallback("meeting", "late", meetingId) },
      { text: "❌ Не смогу", data: encodeCallback("meeting", "no", meetingId) },
    ],
    [
      // Состав с ответами был виден только в трекере, а идёт человек,
      // глядя в телефон: «кто ещё будет» — вопрос, который задают перед
      // встречей, а не после.
      { text: "👥 Кто идёт", data: encodeCallback("meeting", "who", meetingId) },
      { text: "💬 Ответить", data: encodeCallback("meeting", "msg", meetingId) },
    ],
  ];
}

// An idea is not an instruction — there is nothing to accept or finish, so it
// goes without buttons.
// Мысль не обязывает — ни срока, ни отчёта. Единственное, что с ней можно
// сделать, это взять её в работу: тогда она перестаёт быть мыслью и
// становится задачей с исполнителем и сроком. Раньше кнопок не было вовсе,
// и мысль оставалась сообщением, которое некуда деть.
export function ideaButtons(ideaId: string): BotButton[][] {
  return [[{ text: "➕ Взять в работу", data: encodeCallback("idea", "task", ideaId) }]];
}

export async function findColleagueByChat(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
): Promise<{ id: string; name: string; user_id: string } | null> {
  const { data } = await admin
    .from("assignees")
    .select("id, name, user_id")
    .eq(channel.chatColumn, chatId)
    .limit(1)
    .maybeSingle();
  return (data as { id: string; name: string; user_id: string } | null) || null;
}

export async function listColleagues(admin: SupabaseClient, userId: string): Promise<ColleagueRow[]> {
  const { data } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").eq("user_id", userId).order("created_at");
  return (data || []) as ColleagueRow[];
}

// Where this person can be written to, in the order the channels are listed.
// A colleague connected to both gets one message, not two: the first
// messenger they connected through is the one that is used.
export function chatsFor(row: ColleagueRow): { channel: BotChannelConfig; chatId: number }[] {
  const out: { channel: BotChannelConfig; chatId: number }[] = [];
  for (const channel of BOT_CHANNELS) {
    const id = channel.id === "telegram" ? row.telegram_chat_id : row.max_user_id;
    if (id != null) out.push({ channel, chatId: id });
  }
  return out;
}
