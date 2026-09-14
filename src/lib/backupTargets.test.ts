import { describe, it, expect } from "vitest";
import { groupBackupTargets } from "./backupTargets";

// Копия уходит в каждый мессенджер человека, но строится и «оплачивается»
// зачисткой один раз. Ошибка здесь стоит дорого и тихо: лишняя группа —
// это лишняя зачистка удалённых строк, а потерянный получатель — это
// человек без резервной копии, который узнает об этом в худший момент.

describe("группировка получателей резервной копии", () => {
  it("у человека с двумя мессенджерами — одна группа и два адреса", () => {
    const groups = groupBackupTargets(
      [{ telegram_chat_id: 111, user_id: "kirill" }],
      [{ max_user_id: 222, user_id: "kirill" }],
    );
    expect(groups.size).toBe(1);
    expect(groups.get("kirill")).toEqual([
      { channel: "telegram", chatId: 111 },
      { channel: "max", chatId: 222 },
    ]);
  });

  it("разные люди не сливаются в одну группу", () => {
    const groups = groupBackupTargets(
      [{ telegram_chat_id: 111, user_id: "kirill" }],
      [{ max_user_id: 222, user_id: "nikita" }],
    );
    expect(groups.size).toBe(2);
    expect(groups.get("kirill")).toEqual([{ channel: "telegram", chatId: 111 }]);
    expect(groups.get("nikita")).toEqual([{ channel: "max", chatId: 222 }]);
  });

  it("один и тот же чат, записанный дважды, остаётся одним получателем", () => {
    const groups = groupBackupTargets(
      [
        { telegram_chat_id: 111, user_id: "kirill" },
        { telegram_chat_id: 111, user_id: "kirill" },
      ],
      [],
    );
    expect(groups.get("kirill")).toEqual([{ channel: "telegram", chatId: 111 }]);
  });

  it("совпадение чисел в разных мессенджерах — это два разных чата", () => {
    const groups = groupBackupTargets(
      [{ telegram_chat_id: 7, user_id: "kirill" }],
      [{ max_user_id: 7, user_id: "kirill" }],
    );
    expect(groups.get("kirill")).toHaveLength(2);
  });

  it("строки без владельца или без чата пропускаются, а не ломают крон", () => {
    const groups = groupBackupTargets(
      [
        { telegram_chat_id: null, user_id: "kirill" },
        { telegram_chat_id: 111, user_id: null },
      ],
      [{ max_user_id: 222, user_id: "kirill" }],
    );
    expect(groups.get("kirill")).toEqual([{ channel: "max", chatId: 222 }]);
  });

  it("никого не подключено — ни одной группы", () => {
    expect(groupBackupTargets([], []).size).toBe(0);
  });
});
