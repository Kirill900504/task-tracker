import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TELEGRAM_CHANNEL, MAX_CHANNEL } from "@/lib/botTransport";

// Владелец как ПОЛУЧАТЕЛЬ работы — тот случай, которого не было, пока
// поручал только он. Его чат живёт в telegram_accounts/max_accounts, а не
// в строке списка людей, и рассылка, написанная через chatsFor, для него
// молчала: строка участия есть, отказа нет, сообщение не уходит никуда.
//
// Поэтому здесь проверяется не форма ответа, а сама развилка: чья это
// строка и откуда берётся чат. Ошибка тут не видна ни типами (обе ветки
// возвращают одно и то же), ни глазами.

const ownerChats = vi.fn();
const sendToColleague = vi.fn();

vi.mock("@/lib/botDelivery", () => ({
  ownerChats: (...args: unknown[]) => ownerChats(...args),
  sendToColleague: (...args: unknown[]) => sendToColleague(...args),
}));

const { chatsForPerson, sendToPerson } = await import("./reach");

const admin = {} as SupabaseClient;
const colleague = { id: "a1", name: "Игорь Черкашин", telegram_chat_id: 111, max_user_id: null };
const owner = { id: "a0", name: "Кирилл (я)", telegram_chat_id: null, max_user_id: null };

beforeEach(() => {
  ownerChats.mockReset().mockResolvedValue([
    { channel: TELEGRAM_CHANNEL, chatId: 900 },
    { channel: MAX_CHANNEL, chatId: 901 },
  ]);
  sendToColleague.mockReset().mockResolvedValue({ ok: true });
});

describe("chatsForPerson", () => {
  it("у коллеги чат берётся из его строки", async () => {
    const targets = await chatsForPerson(admin, "owner-1", colleague);
    expect(targets).toEqual([{ channel: TELEGRAM_CHANNEL, chatId: 111 }]);
    expect(ownerChats).not.toHaveBeenCalled();
  });

  it("у владельца — из его учётной записи, а не из пустой строки", async () => {
    const targets = await chatsForPerson(admin, "owner-1", owner);
    expect(targets).toHaveLength(2);
    expect(ownerChats).toHaveBeenCalledWith(admin, "owner-1");
  });

  it("владелец без единого подключённого мессенджера — пусто, а не падение", async () => {
    ownerChats.mockResolvedValue([]);
    expect(await chatsForPerson(admin, "owner-1", owner)).toEqual([]);
  });
});

describe("sendToPerson", () => {
  it("коллеге — одно сообщение, в тот мессенджер, через который он подключился", async () => {
    const sent = await sendToPerson(admin, "owner-1", { ...colleague, max_user_id: 222 }, "текст");
    expect(sent).toBe(1);
    expect(sendToColleague).toHaveBeenCalledTimes(1);
    expect(sendToColleague.mock.calls[0][0]).toEqual({ channel: TELEGRAM_CHANNEL, chatId: 111 });
  });

  it("владельцу — во все, что он подключил: он читает тот, что открыт", async () => {
    const sent = await sendToPerson(admin, "owner-1", owner, "текст");
    expect(sent).toBe(2);
    expect(sendToColleague).toHaveBeenCalledTimes(2);
  });

  it("некуда писать — ноль, и ни одной попытки отправки", async () => {
    const sent = await sendToPerson(admin, "owner-1", { ...colleague, telegram_chat_id: null }, "текст");
    expect(sent).toBe(0);
    expect(sendToColleague).not.toHaveBeenCalled();
  });

  it("не дошло — считается недоставленным, а не отправленным", async () => {
    sendToColleague.mockResolvedValue({ ok: false, error: "chat not found" });
    expect(await sendToPerson(admin, "owner-1", colleague, "текст")).toBe(0);
  });
});
