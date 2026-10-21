import { describe, expect, it } from "vitest";
import { splitAgendaText } from "@/lib/botSkills";

// Ответ на «📝 Повестка» в боте (21.10.2026): пункты одним сообщением.
describe("splitAgendaText", () => {
  it("режет по строкам и по «;», снимая нумерацию и маркеры", () => {
    expect(splitAgendaText("1. Смета\n2) Отпуска\n- Склад; Закупки")).toEqual(["Смета", "Отпуска", "Склад", "Закупки"]);
  });

  it("запятая — не разделитель: «смета, подписи и сроки» — один пункт", () => {
    expect(splitAgendaText("Смета, подписи и сроки")).toEqual(["Смета, подписи и сроки"]);
  });

  it("пустые строки пропускает", () => {
    expect(splitAgendaText("\n\r\n  ;")).toEqual([]);
  });
});
