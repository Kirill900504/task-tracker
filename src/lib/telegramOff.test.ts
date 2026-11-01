import { afterEach, describe, expect, it, vi } from "vitest";

// The Moscow server runs with Telegram switched off (TELEGRAM_ENABLED in
// lib/botTransport). The flag is read when the module loads, so each case
// loads the modules afresh under the environment it describes.
async function load(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) vi.stubEnv("NEXT_PUBLIC_TELEGRAM_ENABLED", "");
  else vi.stubEnv("NEXT_PUBLIC_TELEGRAM_ENABLED", flag);
  const transport = await import("@/lib/botTransport");
  const colleagues = await import("@/lib/colleagues");
  return { ...transport, chatsFor: colleagues.chatsFor };
}

const row = { id: "p1", name: "Игорь Петров", telegram_chat_id: 111, max_user_id: null, messenger: null };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Telegram switched off", () => {
  it("leaves a Telegram-only person with no chat at all — «не подключён», not «отправлено»", async () => {
    const { chatsFor, BOT_CHANNELS } = await load("0");
    expect(BOT_CHANNELS.map((c) => c.id)).toEqual(["max"]);
    expect(chatsFor(row)).toEqual([]);
  });

  it("still writes to MAX for someone who has both", async () => {
    const { chatsFor } = await load("0");
    const chats = chatsFor({ ...row, max_user_id: 222, messenger: "telegram" });
    expect(chats.map((c) => [c.channel.id, c.chatId])).toEqual([["max", 222]]);
  });

  it("is on by default, so local runs and tests see both messengers", async () => {
    const { chatsFor, TELEGRAM_ENABLED } = await load(undefined);
    expect(TELEGRAM_ENABLED).toBe(true);
    expect(chatsFor(row).map((c) => c.channel.id)).toEqual(["telegram"]);
  });

  it("refuses a Telegram send at once instead of waiting on the network", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_ENABLED", "0");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const spy = vi.spyOn(globalThis, "fetch");
    const { sendTelegramMessage } = await import("@/lib/telegram");
    const result = await sendTelegramMessage(111, "привет");
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
