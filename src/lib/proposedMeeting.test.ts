import { describe, it, expect } from "vitest";
import { sortMeetingsForList } from "./calendarLogic";
import { buildWeek } from "./weekScreen";
import type { Meeting } from "@/types/tracker";

function meeting(patch: Partial<Meeting>): Meeting {
  return {
    id: Math.random().toString(36).slice(2),
    date: "2026-09-23",
    time: "10:00",
    title: "Планёрка",
    participants: [],
    status: "planned",
    result: "",
    movedToDate: "",
    resolvedAt: "",
    ...patch,
  };
}

const WEDNESDAY = new Date(2026, 8, 23, 12, 0, 0);

describe("предложенная встреча", () => {
  it("стоит в списке вместе с назначенными", () => {
    // Прятать её до подтверждения значит прятать то, на что ждут ответа.
    const list = sortMeetingsForList([meeting({ status: "proposed", title: "Предложенная" })], false);
    expect(list.map((m) => m.title)).toEqual(["Предложенная"]);
  });

  it("но времени в неделе не занимает", () => {
    // В этом и смысл состояния: встреча существует, её видно, по ней можно
    // ответить — а календарь и напоминания спрашивают ровно «planned».
    const days = buildWeek([], [meeting({ status: "proposed" })], WEDNESDAY);
    const wednesday = days.find((d) => d.date === "2026-09-23")!;
    expect(wednesday.meetings).toEqual([]);
  });

  it("назначенная в неделе есть", () => {
    const days = buildWeek([], [meeting({ status: "planned" })], WEDNESDAY);
    expect(days.find((d) => d.date === "2026-09-23")!.meetings).toHaveLength(1);
  });

  it("прошедшие по-прежнему прячутся, пока не попросят показать", () => {
    const list = sortMeetingsForList([meeting({ status: "success" }), meeting({ status: "proposed" })], false);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("proposed");
  });
});
