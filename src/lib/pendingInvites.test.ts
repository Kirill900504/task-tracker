import { describe, it, expect } from "vitest";
import { composePending, groupPending } from "./pendingInvites";

const now = Date.parse("2026-10-07T09:00:00Z");
const ago = (d: number) => new Date(now - d * 864e5).toISOString();
const person = (id: string, name: string, chat: number | null = null) => ({ id, name, telegram_chat_id: chat, max_user_id: null });

describe("ссылку выдали, а человек не подключился", () => {
  it("называет тех, у кого ссылке два дня и больше, по самой свежей ссылке", () => {
    const got = groupPending(
      [
        { assignee_id: "a", created_at: ago(5) },
        { assignee_id: "b", created_at: ago(6) },
        { assignee_id: "b", created_at: ago(1) }, // выдали заново вчера
        { assignee_id: "c", created_at: ago(3) },
        { assignee_id: "d", created_at: ago(40) }, // давно — не повод
      ],
      [person("a", "Иван Петров"), person("b", "Анна Сидорова"), person("c", "Олег Ким", 123), person("d", "Старый")],
      now,
    );
    expect(got).toEqual([{ name: "Иван Петров", days: 5 }]);
  });

  it("молчит, когда говорить не о ком", () => {
    expect(composePending([])).toBe("");
    expect(composePending([{ name: "Иван Петров", days: 5 }])).toContain("Иван Петров — 5 дн.");
  });
});
