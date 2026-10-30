import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/botDelivery", () => ({ ownerChats: vi.fn(), sendToColleague: vi.fn() }));

import { welcomeRefusal } from "@/lib/linkGuard";
import { randomCode } from "@/lib/botInvite";
import type { BotChannelConfig } from "@/lib/botTransport";

const telegram = { id: "telegram", label: "Telegram", chatColumn: "telegram_chat_id" } as BotChannelConfig;
const max = { id: "max", label: "MAX", chatColumn: "max_user_id" } as BotChannelConfig;

// Аудит 30.10.2026: ссылка-приглашение жила неделю и подключала ЛЮБОЙ
// второй мессенджер — кто получил чужую ссылку, становился этим человеком.
describe("приглашение подключает только первый мессенджер", () => {
  it("никто не подключён — можно", () => {
    expect(welcomeRefusal({ telegram_chat_id: null, max_user_id: null }, telegram, 111)).toBeNull();
  });
  it("подключён MAX — Telegram по этой ссылке уже не подключить", () => {
    expect(welcomeRefusal({ telegram_chat_id: null, max_user_id: 555 }, telegram, 111)).toMatch(/Личный кабинет/);
  });
  it("подключён Telegram — MAX тоже нет", () => {
    expect(welcomeRefusal({ telegram_chat_id: 111, max_user_id: null }, max, 555)).toMatch(/Личный кабинет/);
  });
  it("тот же чат ещё раз — просто приветствие", () => {
    expect(welcomeRefusal({ telegram_chat_id: 111, max_user_id: 555 }, telegram, 111)).toBeNull();
  });
  it("в этом мессенджере уже другой аккаунт — отказ", () => {
    expect(welcomeRefusal({ telegram_chat_id: 222, max_user_id: null }, telegram, 111)).toMatch(/другого аккаунта/);
  });
});

describe("коды подключения", () => {
  it("восемь знаков без 0/O/1/I и без повторов на тысяче штук", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => randomCode()));
    expect(codes.size).toBe(1000);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
  it("не берутся из Math.random — его состояние восстанавливается по выдаче", () => {
    const spy = vi.spyOn(Math, "random");
    randomCode();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
