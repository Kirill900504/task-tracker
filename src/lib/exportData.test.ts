import { describe, it, expect } from "vitest";
import { csvCell, toCsv, tasksCsv, meetingsCsv, ideasCsv, buildJson, exportFileName } from "@/lib/exportData";
import type { Idea, Meeting, Section, Task } from "@/types/tracker";

function task(over: Partial<Task>): Task {
  return {
    id: "t1",
    title: "Задача",
    desc: "",
    assignee: "",
    sectionId: "",
    priority: "med",
    term: "short",
    status: "in_progress",
    deadline: "",
    recur: "none",
    recurWeekday: "1",
    recurMonthday: "",
    recurYearDay: "",
    recurYearMonth: "1",
    lastCompletedOn: "",
    manualOrder: null,
    completedAt: "",
    ...over,
  };
}

describe("csvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("Позвонить Сергею")).toBe("Позвонить Сергею");
  });

  it("quotes a value containing the separator", () => {
    expect(csvCell("склад; аренда")).toBe('"склад; аренда"');
  });

  it("doubles quotes inside a quoted value", () => {
    expect(csvCell('сказал "подожди"')).toBe('"сказал ""подожди"""');
  });

  it("quotes a value with a line break", () => {
    expect(csvCell("первая\nвторая")).toBe('"первая\nвторая"');
  });

  it("turns nothing into an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark so Excel reads Cyrillic correctly", () => {
    expect(toCsv(["Заголовок"], [])).toBe("﻿Заголовок");
  });

  it("separates with semicolons and CRLF, which is what Excel here expects", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe("﻿A;B\r\n1;2");
  });
});

describe("tasksCsv", () => {
  const sections: Section[] = [{ id: "s1", name: "Работа", kind: "work", sortOrder: 0 }];

  it("writes the essentials in a readable form", () => {
    const csv = tasksCsv(
      [task({ title: "Смета", assignee: "Игорь", sectionId: "s1", priority: "high", deadline: "2026-09-11", status: "done", completedAt: "2026-09-12T08:00:00.000Z" })],
      sections,
    );
    const row = csv.split("\r\n")[1];
    expect(row).toContain("Смета");
    expect(row).toContain("Игорь");
    expect(row).toContain("Работа");
    expect(row).toContain("Высокий");
    expect(row).toContain("11.09.2026");
    expect(row).toContain("Завершена");
    expect(row).toContain("12.09.2026");
  });

  it("leaves the section empty when the task has none", () => {
    const csv = tasksCsv([task({ title: "Без раздела" })], sections);
    expect(csv.split("\r\n")[1]).toBe("Без раздела;;;;Средний;;Краткосрочная;В работе;;");
  });
});

describe("meetingsCsv", () => {
  it("spells out the outcome and lists participants in one cell", () => {
    const meeting: Meeting = {
      id: "m1",
      date: "2026-09-04",
      time: "10:00",
      title: "Совещание",
      participants: ["Игорь", "Наталья"],
      status: "success",
      result: "Договорились",
      movedToDate: "",
      resolvedAt: "",
    };
    const row = meetingsCsv([meeting]).split("\r\n")[1];
    expect(row).toContain("04.09.2026");
    // Comma-joined, and a comma is not the separator here, so no quoting.
    expect(row).toContain("Игорь, Наталья");
    expect(row).toContain("Успешно");
    expect(row).toContain("Договорились");
  });
});

describe("ideasCsv", () => {
  it("marks the flags in words rather than true/false", () => {
    const idea: Idea = { id: "i1", text: "Отдельный склад", important: true, done: false, createdAt: "04.09.2026 10:00", doneAt: "" };
    expect(ideasCsv([idea]).split("\r\n")[1]).toBe("Отдельный склад;да;;04.09.2026 10:00");
  });
});

describe("buildJson", () => {
  it("includes every list and when it was taken", () => {
    const json = JSON.parse(buildJson({ tasks: [task({})], meetings: [], ideas: [], sections: [], assignees: ["Игорь"] }));
    expect(json.tasks).toHaveLength(1);
    expect(json.assignees).toEqual(["Игорь"]);
    expect(typeof json.exportedAt).toBe("string");
  });
});

describe("exportFileName", () => {
  it("names the file by what is in it and the date", () => {
    expect(exportFileName("задачи", "csv")).toMatch(/^rokas-задачи-\d{4}-\d{2}-\d{2}\.csv$/u);
  });
});
