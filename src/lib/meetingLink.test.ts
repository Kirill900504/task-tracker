import { describe, it, expect } from "vitest";
import { pickMeetingForNotes, mergeResult, type MeetingCandidate } from "@/lib/meetingLink";

function meeting(over: Partial<MeetingCandidate>): MeetingCandidate {
  return {
    id: "m1",
    title: "Встреча",
    date: "2026-09-04",
    time: "10:00",
    participants: [],
    result: "",
    ...over,
  };
}

describe("pickMeetingForNotes", () => {
  it("matches a meeting by a word from its title, inflection and all", () => {
    const candidates = [
      meeting({ id: "склад", title: "Склад в Севастополе" }),
      meeting({ id: "прочее", title: "Планёрка по рекламе" }),
    ];
    const picked = pickMeetingForNotes("Обсудили склады в Севастополе, договорились по аренде", candidates);
    expect(picked?.id).toBe("склад");
  });

  it("matches by a participant when the title says nothing", () => {
    const candidates = [meeting({ id: "с-никитой", title: "Обсуждение", participants: ["Никита Козлов"] })];
    const picked = pickMeetingForNotes("Никита пообещал прислать смету до пятницы", candidates);
    expect(picked?.id).toBe("с-никитой");
  });

  it("returns null when nothing in the story points at any meeting", () => {
    const candidates = [meeting({ id: "склад", title: "Склад в Севастополе" })];
    expect(pickMeetingForNotes("Договорились поменять поставщика упаковки", candidates)).toBeNull();
  });

  it("prefers the stronger match over a weaker one", () => {
    const candidates = [
      meeting({ id: "слабая", title: "Совещание", participants: ["Игорь Витковский"] }),
      meeting({ id: "сильная", title: "Совещание по логистике" }),
    ];
    const picked = pickMeetingForNotes("Совещание по логистике: решили сменить перевозчика", candidates);
    expect(picked?.id).toBe("сильная");
  });

  it("breaks a tie on the most recent meeting", () => {
    const candidates = [
      meeting({ id: "старая", title: "Планёрка", date: "2026-09-01" }),
      meeting({ id: "свежая", title: "Планёрка", date: "2026-09-04" }),
    ];
    expect(pickMeetingForNotes("Планёрка прошла, раздали поручения", candidates)?.id).toBe("свежая");
  });

  it("ignores short words so a stray «по» or «до» matches nothing", () => {
    const candidates = [meeting({ id: "m", title: "По ДО" })];
    expect(pickMeetingForNotes("Поговорили до обеда", candidates)).toBeNull();
  });

  it("returns null on an empty story", () => {
    expect(pickMeetingForNotes("", [meeting({})])).toBeNull();
  });
});

describe("mergeResult", () => {
  it("keeps a note written before the meeting and appends the recap", () => {
    expect(mergeResult("Подготовить смету", "Договорились по срокам")).toBe("Подготовить смету\nДоговорились по срокам");
  });

  it("uses the recap alone when the card was empty", () => {
    expect(mergeResult("", "Договорились по срокам")).toBe("Договорились по срокам");
  });

  it("does not duplicate a recap that is already there", () => {
    expect(mergeResult("Договорились по срокам", "Договорились по срокам")).toBe("Договорились по срокам");
  });

  it("leaves the card untouched when there is no recap", () => {
    expect(mergeResult("Уже записано", "")).toBe("Уже записано");
  });
});
