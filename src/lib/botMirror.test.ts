import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Один ответ — во всех мессенджерах сразу (07.10.2026).
//
// Кирилл нажал «Буду» в Telegram, а в MAX приглашение так и предлагало
// ответить; написал причину отказа в MAX — в Telegram её не было. Здесь
// проверяется не «отправилось ли» (это Telegram и MAX), а то, что легко
// сломать незаметно: нажатое сообщение НЕ правится второй раз (его уже
// переписал ответ на нажатие, и вторая правка в ту же секунду могла бы
// его обогнать), а остальные правятся текстом и кнопками ТЕКУЩЕГО
// состояния; и что исчезнувшая встреча не превращается в правку пустым
// текстом.

const edits: { channel: string; chatId: number; messageId: string; text: string; buttons?: unknown[] }[] = [];

vi.mock("@/lib/botDelivery", () => ({
  TELEGRAM_CHANNEL: { id: "telegram" },
  MAX_CHANNEL: { id: "max" },
  transportFor: (channel: { id: string }) => ({
    edit: async (chatId: number, messageId: string, text: string, buttons?: unknown[]) => {
      edits.push({ channel: channel.id, chatId, messageId, text, buttons });
    },
  }),
}));

const card = vi.fn();
vi.mock("@/lib/colleagueQueries", () => ({
  meetingCard: (...args: unknown[]) => card(...args),
  taskCard: (...args: unknown[]) => card(...args),
}));

const { mirrorAnswer, rememberSent } = await import("./botMirror");

function fakeAdmin(messages: { channel: string; chat_id: number; message_id: string }[], inserted: unknown[] = []): SupabaseClient {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => Promise.resolve({ data: table === "bot_messages" ? messages : [] }),
        maybeSingle: () => Promise.resolve({ data: { id: "a1", name: "Кирилл Кучеренко (я)", user_id: "owner" } }),
        insert: (rows: unknown[]) => {
          inserted.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  edits.length = 0;
  card.mockReset();
});

describe("mirrorAnswer", () => {
  it("переписывает сообщение в другом мессенджере и не трогает нажатое", async () => {
    card.mockResolvedValue({ text: "📅 Тест\n\n✅ Вы подтвердили участие", buttons: [[{ text: "🕐 Опоздаю", data: "m:late:m1" }]] });
    const admin = fakeAdmin([
      { channel: "telegram", chat_id: 11, message_id: "100" },
      { channel: "max", chat_id: 22, message_id: "mid.abc" },
    ]);
    await mirrorAnswer(admin, { kind: "meeting", itemId: "m1", assigneeId: "a1" }, { channel: "telegram", messageId: "100" });
    expect(edits).toEqual([
      {
        channel: "max",
        chatId: 22,
        messageId: "mid.abc",
        text: "📅 Тест\n\n✅ Вы подтвердили участие",
        buttons: [[{ text: "🕐 Опоздаю", data: "m:late:m1" }]],
      },
    ]);
  });

  it("ответ из трекера переписывает все сообщения", async () => {
    card.mockResolvedValue({ text: "x", buttons: [] });
    const admin = fakeAdmin([
      { channel: "telegram", chat_id: 11, message_id: "100" },
      { channel: "max", chat_id: 22, message_id: "mid.abc" },
    ]);
    await mirrorAnswer(admin, { kind: "task", itemId: "t1", assigneeId: "a1" });
    expect(edits.map((e) => e.channel).sort()).toEqual(["max", "telegram"]);
  });

  it("встречи больше нет — ничего не правит", async () => {
    card.mockResolvedValue(null);
    const admin = fakeAdmin([{ channel: "max", chat_id: 22, message_id: "mid.abc" }]);
    await mirrorAnswer(admin, { kind: "meeting", itemId: "gone", assigneeId: "a1" });
    expect(edits).toEqual([]);
  });
});

describe("rememberSent", () => {
  it("запоминает только то, что дошло", async () => {
    const inserted: unknown[] = [];
    const admin = fakeAdmin([], inserted);
    await rememberSent(admin, "owner", { kind: "meeting", itemId: "m1", assigneeId: "a1" }, [
      { channel: { id: "telegram" } as never, chatId: 11, messageId: "100" },
      { channel: { id: "max" } as never, chatId: 22, messageId: undefined },
    ]);
    expect(inserted).toEqual([
      { user_id: "owner", assignee_id: "a1", item_kind: "meeting", item_id: "m1", channel: "telegram", chat_id: 11, message_id: "100" },
    ]);
  });
});
