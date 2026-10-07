import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import { transportFor, TELEGRAM_CHANNEL, MAX_CHANNEL } from "@/lib/botDelivery";
import { meetingCard, taskCard } from "@/lib/colleagueQueries";

// Один ответ — во всех мессенджерах сразу.
//
// Слова Кирилла 07.10.2026: «в телеге нажал „буду участвовать“, а в моём
// МАХ ничего не изменилось… когда я прожал кнопку „не смогу“ через МАХ и
// написал комментарий, это не засинхронилось и не отобразилось в моём же
// боте в ТГ. Я хочу, чтобы они работали абсолютно синхронно».
//
// Одно и то же приглашение лежит у человека в двух чатах (владелец
// получает всё в оба, см. lib/reach), а нажатие переписывало только то
// сообщение, под которым нажали. Второе так и оставалось с кнопками «Буду /
// Не смогу» — то есть врало о том, что ответа нет, и предлагало ответить
// ещё раз. Ответ, данный в трекере, не трогал ни одного.
//
// Поэтому каждое сообщение о задаче или встрече, отправленное человеку,
// запоминается (миграция 0044), а после ответа — откуда бы он ни пришёл —
// все они переписываются под то, что действует СЕЙЧАС. Текст и кнопки
// берутся из тех же карточек, что бот показывает по «Открыть»
// (colleagueQueries): второй способ описать состояние задачи разошёлся бы
// с первым.

export type MirrorRef = { kind: "task" | "meeting"; itemId: string; assigneeId: string };
type Sent = { channel: BotChannelConfig; chatId: number; messageId?: string };

// Сообщения старше месяца не трогаем: они давно уехали вверх, и править их
// незачем, а Telegram часть таких правок отвергает.
const MIRROR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Запомнить отправленное. Молча: память — польза, а не условие отправки.
export async function rememberSent(
  admin: SupabaseClient,
  spaceId: string,
  ref: MirrorRef,
  sent: Sent[],
): Promise<void> {
  const rows = sent
    .filter((s) => s.messageId)
    .map((s) => ({
      user_id: spaceId,
      assignee_id: ref.assigneeId,
      item_kind: ref.kind,
      item_id: ref.itemId,
      channel: s.channel.id,
      chat_id: s.chatId,
      message_id: s.messageId!,
    }));
  if (!rows.length) return;
  const { error } = await admin.from("bot_messages").insert(rows);
  if (error) console.error("bot_messages:", error.message);
}

// Элемента больше нет в прежнем виде — встречу отменили или перенесли. Все
// приглашения о нём, у всех людей и во всех мессенджерах, переписываются
// одной фразой и теряют кнопки: «Буду» под отменённой встречей читается
// как вопрос, на который ещё ждут ответа.
export async function mirrorClosed(admin: SupabaseClient, kind: "task" | "meeting", itemId: string, text: string): Promise<void> {
  try {
    const since = new Date(Date.now() - MIRROR_WINDOW_MS).toISOString();
    const { data } = await admin
      .from("bot_messages")
      .select("channel, chat_id, message_id")
      .eq("item_kind", kind)
      .eq("item_id", itemId)
      .gte("created_at", since);
    const rows = (data || []) as { channel: "telegram" | "max"; chat_id: number; message_id: string }[];
    await Promise.all(rows.map((t) => transportFor(t.channel === "max" ? MAX_CHANNEL : TELEGRAM_CHANNEL).edit(t.chat_id, t.message_id, text, [])));
  } catch (e) {
    console.error("bot mirror:", e instanceof Error ? e.message : String(e));
  }
}

// Переписать все запомненные сообщения человека об этом элементе. `skip` —
// то, под которым только что нажали: его уже переписал ответ на нажатие, и
// вторая правка в ту же секунду могла бы обогнать первую.
export async function mirrorAnswer(
  admin: SupabaseClient,
  ref: MirrorRef,
  skip?: { channel: "telegram" | "max"; messageId?: string },
): Promise<void> {
  try {
    const since = new Date(Date.now() - MIRROR_WINDOW_MS).toISOString();
    const [{ data: rows }, { data: person }] = await Promise.all([
      admin
        .from("bot_messages")
        .select("channel, chat_id, message_id")
        .eq("item_kind", ref.kind)
        .eq("item_id", ref.itemId)
        .eq("assignee_id", ref.assigneeId)
        .gte("created_at", since),
      admin.from("assignees").select("id, name, user_id").eq("id", ref.assigneeId).maybeSingle(),
    ]);
    const targets = ((rows || []) as { channel: "telegram" | "max"; chat_id: number; message_id: string }[]).filter(
      (r) => !(skip && r.channel === skip.channel && r.message_id === skip.messageId),
    );
    const colleague = person as { id: string; name: string; user_id: string } | null;
    if (!targets.length || !colleague) return;

    const today = new Date().toISOString().slice(0, 10);
    const card =
      ref.kind === "meeting"
        ? await meetingCard(admin, colleague, ref.itemId, false)
        : await taskCard(admin, colleague, ref.itemId, today, false);
    // Элемента больше нет (удалён, отменён) — переписывать нечем; о
    // отмене человеку уже сказали отдельным сообщением.
    if (!card) return;

    // Все чаты — одновременно: каждая правка — полёт до Telegram или до MAX
    // в России, и ждать их по очереди незачем.
    await Promise.all(
      targets.map((t) =>
        transportFor(t.channel === "max" ? MAX_CHANNEL : TELEGRAM_CHANNEL).edit(t.chat_id, t.message_id, card.text, card.buttons),
      ),
    );
  } catch (e) {
    // Косметика: ответ уже записан, и уронить его из-за того, что не
    // переписалось соседнее сообщение, было бы обменом наоборот.
    console.error("bot mirror:", e instanceof Error ? e.message : String(e));
  }
}
