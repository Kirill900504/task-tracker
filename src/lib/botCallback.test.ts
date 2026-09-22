import { describe, it, expect } from "vitest";
import { asScreen } from "@/lib/botCallback";
import { decodeCallback, encodeCallback, screenButtons } from "@/lib/colleagues";
import type { CallbackAction } from "@/lib/colleagues";

// Экран бота: следующий уровень занимает место прежнего.
//
// Проверяется здесь не оформление, а единственное решение, из-за которого
// история чата либо остаётся читаемой, либо растёт лентой одноразовых
// сообщений. Ошибка в любую сторону молчалива: в одну — чат засоряется, в
// другую — переписывается чужой текст (утренняя сводка, присланная
// задача), и человек теряет то, за чем пришёл.

const fromScreen = (action: string): CallbackAction =>
  decodeCallback(screenButtons([[{ text: "x", data: encodeCallback("task", action, "id1") }]])[0][0].data)!;

const fromMessage = (action: string): CallbackAction => decodeCallback(encodeCallback("task", action, "id1"))!;

describe("экран бота", () => {
  it("показывает следующий уровень на месте прежнего, когда нажали внутри экрана", () => {
    const out = asScreen(fromScreen("olist"), { toast: "Открываю", say: "📋 Задачи (2)", sayButtons: [[{ text: "☰ Меню", data: "t:omenu:x" }]] });
    expect(out.rewriteTo).toBe("📋 Задачи (2)");
    expect(out.say).toBeUndefined();
  });

  it("оставляет присланную задачу и сводку в покое: уровень открывается новым сообщением", () => {
    const out = asScreen(fromMessage("olist"), { toast: "Открываю", say: "📋 Задачи (2)" });
    expect(out.say).toBe("📋 Задачи (2)");
    expect(out.rewriteTo).toBeUndefined();
  });

  it("помечает кнопки нового уровня — иначе экран переписался бы ровно один раз", () => {
    const out = asScreen(fromMessage("olist"), {
      toast: "Открываю",
      say: "📋 Задачи",
      sayButtons: [[{ text: "☰ Меню", data: encodeCallback("task", "omenu", "x") }]],
    });
    expect(decodeCallback(out.sayButtons![0][0].data)?.fromScreen).toBe(true);
  });

  it("и помечает кнопки, оставшиеся на переписанном экране", () => {
    const out = asScreen(fromScreen("oshow"), {
      toast: "Открываю",
      say: "📋 Задача",
      sayButtons: [[{ text: "📅 Продлить срок", data: encodeCallback("task", "plus", "id1") }]],
    });
    expect(decodeCallback(out.rewriteButtons![0][0].data)?.fromScreen).toBe(true);
  });

  // Карточка задачи, присланной человеку, тоже переписывается — «Принял»
  // меняет её текст. Но она не уровень меню: пометить её кнопки значило бы
  // объявить экраном сообщение, которое им не является, и следующий ответ
  // бота затёр бы саму задачу.
  it("не объявляет экраном присланную задачу, которая переписала себя сама", () => {
    const out = asScreen(fromMessage("acc"), {
      toast: "Принято",
      rewriteTo: "✅ Принял",
      rewriteButtons: [[{ text: "🏁 Сделал", data: encodeCallback("task", "done", "id1") }]],
    });
    expect(decodeCallback(out.rewriteButtons![0][0].data)?.fromScreen).toBeUndefined();
  });

  it("не трогает ответ, которому нечего показывать", () => {
    expect(asScreen(fromScreen("ok"), { toast: "Принято" })).toEqual({ toast: "Принято" });
  });
});
