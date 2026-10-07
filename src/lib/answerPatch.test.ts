import { describe, it, expect } from "vitest";
import { answerPatch } from "./answerPatch";

// Экран меняется до ответа сервера, поэтому то, что он рисует, обязано
// совпадать с тем, что запишет маршрут, — иначе через полсекунды карточка
// «передумает» у человека на глазах.
describe("answerPatch — ответ на экране до подтверждения", () => {
  const now = "2026-10-07T10:00:00.000Z";

  it("«Принял» ставит только отметку принятия", () => {
    expect(answerPatch({ action: "accept" }, now)).toEqual({ acceptedAt: now });
  });

  it("«Сделал» снимает прежний отказ и просьбу о переносе, как маршрут", () => {
    expect(answerPatch({ action: "done", comment: "  готово  " }, now)).toEqual({
      doneAt: now,
      doneComment: "готово",
      declinedAt: null,
      declineReason: null,
      rescheduleTo: null,
      rescheduleReason: null,
    });
  });

  it("«Не могу» снимает отчёт", () => {
    expect(answerPatch({ action: "decline", comment: "болею" }, now)).toEqual({ declinedAt: now, declineReason: "болею", doneAt: null, doneComment: null });
  });

  it("просьба о переносе несёт дату и причину", () => {
    expect(answerPatch({ action: "reschedule", date: "2026-10-10", comment: "жду поставщика" }, now)).toEqual({
      rescheduleTo: "2026-10-10",
      rescheduleReason: "жду поставщика",
    });
  });

  it("неизвестное действие экран не трогает — его покажет перечитывание", () => {
    expect(answerPatch({ action: "seen" }, now)).toBeNull();
    expect(answerPatch({ action: "vote" }, now)).toBeNull();
  });
});
