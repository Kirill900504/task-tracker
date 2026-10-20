import { describe, expect, it } from "vitest";
import { contextBlock, rankLessons, replyContext } from "@/lib/botMemory";
import { encodeCallback, meetingButtons, screenButtons } from "@/lib/colleagues";
import { moveData, splitTarget } from "@/lib/botMoveFlow";
import { keyboardAttachment } from "@/lib/max";
import { menuButtons } from "@/lib/botMenu";
import { recapButtons } from "@/lib/meetingReminders";

describe("реплай: о каком деле речь", () => {
  it("встреча — из данных кнопок под сообщением", () => {
    const data = recapButtons("tmeet123abc").flat().map((b) => b.data);
    expect(replyContext("📝 Встреча прошла: «телемост»", data)).toEqual({ text: "📝 Встреча прошла: «телемост»", item: { kind: "meeting", id: "tmeet123abc" } });
  });
  it("кнопки экрана (со знаком) и кнопки с днём — тот же id", () => {
    const data = screenButtons([[{ text: "x", data: moveData("meeting", "mvd", "tmeet123abc", "2026-10-26") }]]).flat().map((b) => b.data);
    expect(replyContext("", data)?.item).toEqual({ kind: "meeting", id: "tmeet123abc" });
  });
  it("кнопки меню и людей — не дело", () => {
    const data = [encodeCallback("task", "omenu", "x"), encodeCallback("task", "olist", "all"), encodeCallback("task", "oper", "assignee-uuid-1")];
    expect(replyContext("Что показать?", data)).toEqual({ text: "Что показать?", item: null });
  });
  it("напоминание без кнопок — только текст", () => {
    expect(replyContext("🔔 Через 15 минут: «телемост»", [])).toEqual({ text: "🔔 Через 15 минут: «телемост»", item: null });
  });
});

describe("подсказка модели", () => {
  it("разговор и реплай попадают в текст", () => {
    const block = contextBlock(
      [
        { role: "user", body: "Перенеси на неделю" },
        { role: "bot", body: "Переношу с 19.10.2026 на 26.10.2026 — 3 записи" },
      ],
      "🔔 Через 15 минут: «телемост с Вадимом»",
    );
    expect(block).toContain("Пользователь: Перенеси на неделю");
    expect(block).toContain("Бот: Переношу с 19.10.2026");
    expect(block).toContain("ОТВЕТИЛ на это сообщение бота");
    expect(block).toContain("телемост с Вадимом");
  });
  it("пусто — пусто", () => {
    expect(contextBlock([], "")).toBe("");
  });
  it("уроки — похожие по словам, не любые", () => {
    const lessons = [
      { phrase: "перенеси телемост на понедельник", parsed: { type: "move_item" } },
      { phrase: "позвонить в банк завтра", parsed: { type: "task" } },
    ];
    expect(rankLessons(lessons, "перенеси телемост на 26.10").map((l) => l.phrase)).toEqual(["перенеси телемост на понедельник"]);
  });
});

describe("данные кнопки переноса", () => {
  it("id, день и время едут туда и обратно", () => {
    const data = moveData("meeting", "mvgo", "tmh2k3x9abcde", "2026-10-26", "14:00");
    const action = data.split(":")[2];
    expect(splitTarget(action)).toEqual({ id: "tmh2k3x9abcde", date: "2026-10-26", time: "14:00" });
  });
  it("влезают в 64 байта Telegram даже со знаком экрана и длинным id", () => {
    const long = "bot" + "x".repeat(20);
    const marked = screenButtons([[{ text: "x", data: moveData("meeting", "mvgo", long, "2026-10-26", "14:00") }]])[0][0].data;
    expect(Buffer.byteLength(marked)).toBeLessThanOrEqual(64);
  });
  it("без дня — только id", () => {
    expect(splitTarget("tmh2k3x9abcde")).toEqual({ id: "tmh2k3x9abcde", date: "", time: "" });
  });
});

describe("MAX — меню вместо мини-приложения", () => {
  it("кнопки мини-приложения в MAX нет, остальное на месте", () => {
    const keyboard = keyboardAttachment(menuButtons("assigner"), "rokas_bot");
    const all = keyboard.payload.buttons.flat();
    expect(all.some((b) => b.type === "open_app" || b.type === "link")).toBe(false);
    expect(all.some((b) => b.text.includes("Задачи"))).toBe(true);
    expect(keyboard.payload.buttons.every((row) => row.length > 0)).toBe(true);
  });
  it("под приглашением — «Предложить другое время»", () => {
    expect(meetingButtons("tmeet1").flat().some((b) => b.data === encodeCallback("meeting", "pp", "tmeet1"))).toBe(true);
  });
});
