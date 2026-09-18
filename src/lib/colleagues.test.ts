import { describe, it, expect } from "vitest";
import { encodeCallback, decodeCallback, taskMessage, meetingMessage, ideaMessage, taskButtons, meetingButtons, ideaButtons, rescheduleButtons, chatsFor } from "@/lib/colleagues";

describe("callback data", () => {
  it("survives a round trip", () => {
    const encoded = encodeCallback("task", "acc", "abc123");
    expect(decodeCallback(encoded)).toEqual({ kind: "task", action: "acc", id: "abc123" });
  });

  it("stays inside Telegram's 64-byte limit for a real id", () => {
    expect(encodeCallback("meeting", "yes", "tg" + "m".repeat(20)).length).toBeLessThanOrEqual(64);
  });

  it("understands all three kinds", () => {
    expect(decodeCallback("t:acc:1")?.kind).toBe("task");
    expect(decodeCallback("m:yes:1")?.kind).toBe("meeting");
    expect(decodeCallback("i:x:1")?.kind).toBe("idea");
  });

  it("rejects anything malformed rather than guessing", () => {
    expect(decodeCallback("")).toBeNull();
    expect(decodeCallback("nonsense")).toBeNull();
    expect(decodeCallback("x:acc:1")).toBeNull();
    expect(decodeCallback("t:acc:")).toBeNull();
    expect(decodeCallback("t:acc:1:extra")).toBeNull();
  });
});

describe("what a colleague receives", () => {
  it("says who it is from, and shows the deadline and priority", () => {
    const text = taskMessage({ title: "Подготовить смету", deadline: "2026-09-11", priority: "high" }, "Кирилл");
    expect(text).toContain("Кирилл");
    expect(text).toContain("Подготовить смету");
    expect(text).toContain("11.09.2026");
    expect(text).toContain("важно");
  });

  it("leaves out what a task does not have", () => {
    const text = taskMessage({ title: "Купить воду" }, "Кирилл");
    expect(text).toContain("Купить воду");
    expect(text).not.toContain("срок");
    expect(text).not.toContain("важно");
  });

  it("gives a meeting its date, time and the other participants", () => {
    const text = meetingMessage({ title: "Совещание", date: "2026-09-10", time: "11:00", participants: ["Никита", "Игорь"] }, "Кирилл");
    expect(text).toContain("10.09.2026, 11:00");
    expect(text).toContain("Никита, Игорь");
  });

  it("does not list participants when there is only the one recipient", () => {
    const text = meetingMessage({ title: "Разговор", date: "2026-09-10", participants: ["Никита"] }, "Кирилл");
    expect(text).not.toContain("Участники");
  });

  it("passes a thought through as it was written", () => {
    expect(ideaMessage("Открыть склад в Севастополе", "Кирилл")).toContain("Открыть склад в Севастополе");
  });
});

describe("buttons", () => {
  it("offers accept and done on a task, both carrying its id", () => {
    const rows = taskButtons("t42");
    expect(rows[0].map((b) => b.data)).toEqual(["t:acc:t42", "t:done:t42"]);
  });

  it("отчитаться предлагает только исполнителю", () => {
    // «Сделал» от наблюдателя — отчёт, которого никто не ждал, и постановщик
    // решит, что работу сделал человек, которого на неё не ставили. У
    // соисполнителя то же самое с другой стороны: закрытие задачи считает
    // исполнителей, а сообщение владельцу уходило со словами «выполнил свою
    // часть» — то есть говорило о продвижении, которого не произошло.
    const all = (role?: "executor" | "coexecutor" | "watcher") => taskButtons("t42", role).flat().map((b) => b.data);
    expect(all("watcher")).not.toContain("t:done:t42");
    expect(all("coexecutor")).not.toContain("t:done:t42");
    expect(all()).toContain("t:done:t42");
  });

  it("слово сказать может каждый, включая наблюдателя", () => {
    // Раньше наблюдателю приходило сообщение вовсе без кнопок — ответить на
    // него было нечем, при том что обсуждение задачи он видит целиком.
    for (const role of ["executor", "coexecutor", "watcher"] as const) {
      expect(taskButtons("t42", role).flat().map((b) => b.data)).toContain("t:msg:t42");
    }
  });

  it("даёт мысли единственное осмысленное действие", () => {
    // Мысль ничего не требует; взять её в работу — это всё, что с ней
    // можно сделать, и до сих пор нельзя было ничего.
    const rows = ideaButtons("i9");
    expect(rows[0][0].data).toBe("i:task:i9");
    expect(rows[0][0].text).toContain("работу");
  });

  it("gives a третью дверь: не могу", () => {
    // Без неё человек, который не может, просто молчит — ровно тот сбой,
    // ради устранения которого весь этот механизм и существует.
    const rows = taskButtons("t42");
    expect(rows[1][0].data).toBe("t:no:t42");
    expect(rows[1][0].text).toContain("Не могу");
  });

  it("спрашивает про встречу тремя ответами, а не двумя", () => {
    // Один вариант ответа не отличал «не придёт» от «не ответил», а
    // организатору нужна именно эта разница. Третий — «опоздаю»: без него
    // задерживающийся выбирал из двух неправд и на практике жал «буду»,
    // после чего организатор узнавал о задержке в момент задержки.
    expect(meetingButtons("m7")[0].map((b) => b.data)).toEqual(["m:yes:m7", "m:late:m7", "m:no:m7"]);
  });

  it("даёт спросить, кто ещё идёт, и сказать слово", () => {
    // Состав с ответами был виден только в трекере, а идёт человек, глядя
    // в телефон.
    const all = meetingButtons("m7").flat().map((b) => b.data);
    expect(all).toContain("m:who:m7");
    expect(all).toContain("m:msg:m7");
  });

  it("исполнителю даёт четвёртую дверь — попросить перенос", () => {
    // В трекере она была с самого начала, в мессенджере её не было, и выбор
    // у большинства стоял между «не могу» и молчанием.
    expect(taskButtons("t42").flat().map((b) => b.data)).toContain("t:mv:t42");
  });

  it("сроки переноса — кнопками, и каждая несёт свой сдвиг", () => {
    const data = rescheduleButtons("t42").flat().map((b) => b.data);
    expect(data).toContain("t:mv1:t42");
    expect(data).toContain("t:mv7:t42");
    // Отмена возвращает в карточку, а не оставляет человека в тупике.
    expect(data).toContain("t:show:t42");
  });
});

describe("chatsFor", () => {
  const row = { id: "a1", name: "Игорь Витковский" };

  it("says where a colleague can be written to", () => {
    expect(chatsFor({ ...row, telegram_chat_id: 111, max_user_id: null })).toEqual([
      { channel: expect.objectContaining({ id: "telegram" }), chatId: 111 },
    ]);
    expect(chatsFor({ ...row, telegram_chat_id: null, max_user_id: 222 })).toEqual([
      { channel: expect.objectContaining({ id: "max" }), chatId: 222 },
    ]);
  });

  it("puts Telegram first for someone connected to both, so one message goes out and not two", () => {
    const both = chatsFor({ ...row, telegram_chat_id: 111, max_user_id: 222 });
    expect(both).toHaveLength(2);
    expect(both[0].channel.id).toBe("telegram");
  });

  it("gives nothing for someone who has connected nothing", () => {
    expect(chatsFor({ ...row, telegram_chat_id: null, max_user_id: null })).toEqual([]);
  });
});
