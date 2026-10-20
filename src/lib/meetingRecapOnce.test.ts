import { describe, it, expect } from "vitest";
import { closedMeetingText, recordRecapButtons } from "./meetingRecap";

// Итог встречи пишется один раз (17.10.2026: «почему позволяет по
// несколько раз записывать итог»): кнопка «Записать итог» живёт только
// пока итога нет, а закрытая встреча во всех мессенджерах читается одной
// и той же фразой.
describe("итог встречи — один раз", () => {
  it("кнопка «Записать итог» есть, пока итога нет, и исчезает, как только он записан", () => {
    expect(recordRecapButtons("m1", "")).toHaveLength(1);
    expect(recordRecapButtons("m1", "   ")).toHaveLength(1);
    expect(recordRecapButtons("m1", "Договорились")).toEqual([]);
  });

  it("закрытая встреча с итогом показывает итог, без него — только исход", () => {
    expect(closedMeetingText("Планёрка", "success", "Тест прошёл")).toBe("✅ Встреча «Планёрка» закрыта.\n\n📝 Итог: Тест прошёл");
    expect(closedMeetingText("Планёрка", "no_result", "")).toBe("⚪ Встреча «Планёрка» закрыта без результата.");
  });
});
