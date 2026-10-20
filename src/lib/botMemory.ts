import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotTransport } from "@/lib/botTransport";
import { sameWord, words } from "@/lib/itemMatch";
import { decodeCallback } from "@/lib/colleagues";

// Память бота (миграция 0065): разговор и уроки.
//
// Разговор — чтобы «Только телемост», «На 26.10» и «26.10» читались как
// уточнения к тому, что было сказано минуту назад, а не как три новые
// просьбы без смысла (так было 19.10.2026, семь сообщений подряд).
//
// Уроки — чтобы бот учился на том, как говорит ЭТОТ человек: фраза и
// разбор, который он подтвердил «да» или кнопкой, ложатся в подсказку
// модели примером, когда он скажет похожее. Урок принадлежит тому, кто его
// дал, — фраза одного человека не попадает в подсказку другому.
//
// Всё здесь молчит при ошибке: память — польза, а не условие. Бот,
// который не смог записать реплику, обязан ответить на неё всё равно.

export type DialogLine = { role: "user" | "bot"; body: string };
export type ChatRef = { spaceId: string; channel: "telegram" | "max"; chatId: number };

// Сколько разговора видит модель. Полчаса — длина одного разговора о
// деле; вчерашняя переписка ему не контекст, а шум.
const DIALOG_WINDOW_MS = 30 * 60 * 1000;
const DIALOG_LINES = 10;
// Длинная реплика бота (список задач, сводка) режется: модели нужно, о чём
// шла речь, а не весь список.
const LINE_LIMIT = 600;

export async function rememberLine(admin: SupabaseClient, ref: ChatRef, role: DialogLine["role"], body: string): Promise<void> {
  const text = String(body || "").trim();
  if (!text) return;
  try {
    await admin.from("bot_dialog").insert({
      user_id: ref.spaceId,
      channel: ref.channel,
      chat_id: ref.chatId,
      role,
      body: text.slice(0, LINE_LIMIT),
    });
  } catch {
    // Таблицы может не быть (миграция не применена) — бот работает и так.
  }
}

export async function recentDialog(admin: SupabaseClient, ref: Pick<ChatRef, "channel" | "chatId">): Promise<DialogLine[]> {
  try {
    const since = new Date(Date.now() - DIALOG_WINDOW_MS).toISOString();
    const { data, error } = await admin
      .from("bot_dialog")
      .select("role, body")
      .eq("channel", ref.channel)
      .eq("chat_id", ref.chatId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(DIALOG_LINES);
    if (error) return [];
    return ((data || []) as DialogLine[]).reverse();
  } catch {
    return [];
  }
}

// Транспорт, который записывает каждую реплику бота в разговор. Обёртка, а
// не правка каждого `say`: ответов у бота десятки, и забытый один выпадал
// бы из памяти — модель видела бы вопрос человека без ответа на него.
export function recordingTransport(transport: BotTransport, admin: SupabaseClient, ref: ChatRef): BotTransport {
  return {
    ...transport,
    send: async (chatId, text, options) => {
      const sent = await transport.send(chatId, text, options);
      if (chatId === ref.chatId) {
        // Кнопки — тоже часть сказанного: «Нашёл две встречи» без их
        // названий модели ничего не говорит.
        const buttons = (options?.buttons || []).flat().map((b) => b.text).filter(Boolean);
        await rememberLine(admin, ref, "bot", buttons.length ? `${text}\n[кнопки: ${buttons.slice(0, 8).join(" | ")}]` : text);
      }
      return sent;
    },
  };
}

// Сообщение бота, на которое человек ответил (реплай). 19.10.2026 Кирилл
// ответил на напоминание «Через 15 минут: «телемост…»» словами «Перенеси эту
// встречу на следующий понедельник» — а бот реплая не видел вовсе, и «эту»
// не значило для него ничего. Теперь видит: текст того сообщения и, если
// под ним были кнопки, само дело — его id едет в данных кнопок, и это
// надёжнее любого названия.
export type ReplyContext = { text: string; item: { kind: "meeting" | "task"; id: string } | null };

export function replyContext(text: string, callbackData: string[]): ReplyContext | null {
  const body = String(text || "").trim();
  let item: ReplyContext["item"] = null;
  for (const data of callbackData) {
    const action = decodeCallback(data);
    if (!action || (action.kind !== "meeting" && action.kind !== "task")) continue;
    // Кнопки про людей и шаги мастера несут id человека, а не дела.
    if (/^(oper|npers|nwho|nsec|nwhen|ndesc|olist|omenu|list|new)/.test(action.action)) continue;
    const id = action.id.includes(".") ? action.id.slice(0, action.id.lastIndexOf(".")) : action.id;
    // Кнопки меню несут не id, а слово («menu», «all», «x») — это не дело.
    if (!id || id.length < 6 || /^(menu|all|my|today|overdue|review|help|people|enter|start|x)$/.test(id)) continue;
    item = { kind: action.kind, id };
    break;
  }
  if (!body && !item) return null;
  return { text: body, item };
}

// Разговор и сообщение, на которое ответили, — текстом для подсказки.
export function contextBlock(lines: DialogLine[], replyTo: string): string {
  const parts: string[] = [];
  if (lines.length) {
    parts.push(
      "Недавний разговор с пользователем (старое сверху). Новое сообщение может быть УТОЧНЕНИЕМ к нему — тогда разбирай его вместе с этим разговором:",
      ...lines.map((l) => `${l.role === "user" ? "Пользователь" : "Бот"}: ${l.body.replace(/\s+/g, " ").slice(0, 400)}`),
    );
  }
  if (replyTo.trim()) {
    parts.push(
      "",
      `Пользователь ОТВЕТИЛ на это сообщение бота (его слова «эта встреча», «эту задачу», «её», «перенеси» — про то, что в нём): «${replyTo.replace(/\s+/g, " ").slice(0, 500)}»`,
    );
  }
  return parts.join("\n");
}

// --------------------------------------------------------------- уроки

export type Lesson = { phrase: string; parsed: unknown };

// Чей урок. Владелец — id пространства (он и есть его auth-id), остальные —
// свой auth-id: урок едет за человеком, а не за чатом, и Telegram с MAX у
// него общие.
export function lessonActor(actor: { isOwner: boolean; spaceId: string; userId: string }): string {
  return actor.isOwner ? actor.spaceId : actor.userId;
}

export async function saveLesson(admin: SupabaseClient, input: { spaceId: string; actor: string; phrase: string; parsed: unknown }): Promise<void> {
  const phrase = String(input.phrase || "").trim();
  if (!phrase || phrase.length > 400 || !input.actor) return;
  try {
    // Тот же урок дважды не нужен: «да» на ту же фразу — не новое знание.
    const { data } = await admin.from("bot_lessons").select("id").eq("actor", input.actor).eq("phrase", phrase).limit(1);
    if (data?.length) return;
    await admin.from("bot_lessons").insert({ user_id: input.spaceId, actor: input.actor, phrase, parsed: input.parsed });
  } catch {
    // См. выше: без памяти бот работает.
  }
}

// Похожие уроки — по общим словам. Свежие важнее: человек меняет манеру, а
// старый урок мог быть подтверждён по ошибке.
export function rankLessons(lessons: Lesson[], phrase: string, limit = 5): Lesson[] {
  const said = words(phrase);
  if (!said.length) return [];
  return lessons
    .map((lesson, i) => {
      const own = words(lesson.phrase);
      const hits = said.filter((w) => own.some((x) => sameWord(w, x))).length;
      return { lesson, score: hits / Math.max(said.length, own.length) - i * 0.001 };
    })
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.lesson);
}

export async function lessonsFor(admin: SupabaseClient, actor: string, phrase: string): Promise<Lesson[]> {
  if (!actor) return [];
  try {
    const { data, error } = await admin.from("bot_lessons").select("phrase, parsed").eq("actor", actor).order("created_at", { ascending: false }).limit(80);
    if (error) return [];
    return rankLessons((data || []) as Lesson[], phrase);
  } catch {
    return [];
  }
}

export function lessonsBlock(lessons: Lesson[]): string {
  if (!lessons.length) return "";
  return [
    "Так этот пользователь уже говорил раньше, и такой разбор он ПОДТВЕРДИЛ. Похожую фразу разбирай так же (даты пересчитай заново, не копируй):",
    ...lessons.map((l) => `«${l.phrase}» → ${JSON.stringify(l.parsed)}`),
  ].join("\n");
}
