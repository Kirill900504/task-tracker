import { describe, it, expect } from "vitest";
import { resolveWhen, mergeMissedTasks, MAX_EXTRA_TASKS, type ExtractedTask } from "./meetingNotes";

// The model returns a label ("friday"), never a date — turning that into a
// real date is this function's job, precisely because the model got the
// arithmetic wrong when it was asked to do it (see meetingNotes.ts).
const SATURDAY = new Date(2026, 8, 5); // 2026-09-05 is a Saturday

describe("resolveWhen", () => {
  it("returns no deadline when none was mentioned", () => {
    expect(resolveWhen("none", SATURDAY)).toBe("");
    expect(resolveWhen("", SATURDAY)).toBe("");
  });

  it("resolves the relative labels", () => {
    expect(resolveWhen("today", SATURDAY)).toBe("2026-09-05");
    expect(resolveWhen("tomorrow", SATURDAY)).toBe("2026-09-06");
    expect(resolveWhen("day_after", SATURDAY)).toBe("2026-09-07");
    expect(resolveWhen("next_week", SATURDAY)).toBe("2026-09-12");
  });

  it("resolves a weekday to its next occurrence", () => {
    // The case the model kept getting wrong: from Saturday the 5th,
    // "до пятницы" is the 11th, not the 6th.
    expect(resolveWhen("friday", SATURDAY)).toBe("2026-09-11");
    expect(resolveWhen("monday", SATURDAY)).toBe("2026-09-07");
    expect(resolveWhen("sunday", SATURDAY)).toBe("2026-09-06");
  });

  it("treats the current weekday as today, not a week away", () => {
    expect(resolveWhen("saturday", SATURDAY)).toBe("2026-09-05");
  });

  it("reads 'this_week' as the end of the working week", () => {
    const monday = new Date(2026, 8, 7);
    expect(resolveWhen("this_week", monday)).toBe("2026-09-11");
  });

  it("ignores labels it doesn't know rather than inventing a date", () => {
    expect(resolveWhen("послезавтра", SATURDAY)).toBe("");
    expect(resolveWhen("2026-09-30", SATURDAY)).toBe("");
  });

  it("is case-insensitive and tolerates padding", () => {
    expect(resolveWhen("  Friday ", SATURDAY)).toBe("2026-09-11");
  });
});

describe("mergeMissedTasks", () => {
  const t = (title: string): ExtractedTask => ({ title, assignee: "", deadline: "", priority: "med" });
  const story =
    "Игорь готовит смету по складу. Наталья свяжется с перевозчиком. " +
    "Юра посмотрит договор аренды, сроки не горят.";

  it("adds a task the first pass missed", () => {
    const merged = mergeMissedTasks([t("Подготовить смету по складу")], [t("Посмотреть договор аренды")], story);
    expect(merged.map((x) => x.title)).toEqual(["Подготовить смету по складу", "Посмотреть договор аренды"]);
  });

  it("does not add the same task worded differently", () => {
    const merged = mergeMissedTasks([t("Подготовить смету по складу")], [t("Смета по складу подготовить")], story);
    expect(merged).toHaveLength(1);
  });

  it("drops an invented task whose words are not in the story", () => {
    const merged = mergeMissedTasks([t("Подготовить смету")], [t("Заказать новые визитки дизайнеру")], story);
    expect(merged).toHaveLength(1);
  });

  it("keeps a reworded task that still comes from the story", () => {
    const merged = mergeMissedTasks([t("Подготовить смету")], [t("Связаться с перевозчиком")], story);
    expect(merged).toHaveLength(2);
  });

  it("never lets the second pass more than triple-add", () => {
    const extra = [t("Связаться с перевозчиком"), t("Посмотреть договор аренды"), t("Смета по складу"), t("Аренда склада сроки")];
    const merged = mergeMissedTasks([t("Первое поручение")], extra, story);
    expect(merged.length).toBeLessThanOrEqual(1 + MAX_EXTRA_TASKS);
  });

  it("ignores an empty title", () => {
    expect(mergeMissedTasks([t("Смета")], [t("   ")], story)).toHaveLength(1);
  });
});
