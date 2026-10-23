import { describe, expect, it } from "vitest";
import { copySourceAuthor, incomingFor, recipientState, sentAwayIds, sentToByIdea, stateLabel, takenIdeaAuthor, type IdeaRecipientRow } from "./ideaRecipients";

function row(over: Partial<IdeaRecipientRow> = {}): IdeaRecipientRow {
  return {
    id: "r1",
    ideaId: "i1",
    assigneeId: "a-igor",
    seenAt: null,
    convertedTaskId: null,
    createdAt: "2026-10-07T10:00:00Z",
    idea: { text: "Мысль", createdBy: "u-manager", createdAt: "2026-10-07T09:00:00Z", done: false, deletedAt: null },
    ...over,
  };
}

describe("recipientState", () => {
  it("взятая в работу важнее отметки «видел»", () => {
    expect(recipientState({ seenAt: "x", convertedTaskId: "t1" })).toBe("taken");
    expect(recipientState({ seenAt: "x", convertedTaskId: null })).toBe("seen");
    expect(recipientState({ seenAt: null, convertedTaskId: null })).toBe("none");
  });
});

describe("sentToByIdea — кому ушла мысль", () => {
  it("снимает пометку «(я)» с имени владельца", () => {
    const out = sentToByIdea([row({ assigneeId: "a-owner" })], { "a-owner": "Кирилл Кучеренко (я)" });
    expect(out.i1).toEqual([{ name: "Кирилл Кучеренко", state: "none", kind: "send" }]);
  });

  it("идёт в порядке отправки и пропускает убранных из списка людей", () => {
    const out = sentToByIdea(
      [
        row({ id: "r2", assigneeId: "a-anna", createdAt: "2026-10-07T12:00:00Z", seenAt: "y" }),
        row({ id: "r1", assigneeId: "a-igor" }),
        row({ id: "r3", assigneeId: "a-gone" }),
      ],
      { "a-igor": "Игорь Витковский", "a-anna": "Анна Котова" },
    );
    expect(out.i1.map((s) => s.name)).toEqual(["Игорь Витковский", "Анна Котова"]);
    expect(out.i1[1].state).toBe("seen");
  });
});

describe("incomingFor — что ждёт ответа у получателя", () => {
  it("показывает только мои строки без ответа", () => {
    const rows = [
      row({ id: "mine" }),
      row({ id: "other", assigneeId: "a-anna" }),
      row({ id: "taken", convertedTaskId: "t1" }),
      row({ id: "seen", seenAt: "2026-10-07T11:00:00Z" }),
    ];
    expect(incomingFor(rows, "a-igor", "u-igor").map((r) => r.id)).toEqual(["mine"]);
  });

  it("не показывает удалённую, вычеркнутую и невидимую мысль", () => {
    const base = row().idea!;
    const rows = [
      row({ id: "deleted", idea: { ...base, deletedAt: "x" } }),
      row({ id: "done", idea: { ...base, done: true } }),
      row({ id: "hidden", idea: null }),
    ];
    expect(incomingFor(rows, "a-igor", "u-igor")).toEqual([]);
  });

  it("свою мысль, отправленную себе, не показывает — она и так в списке", () => {
    // Владелец: его «я» пустое, и created_by его мыслей пуст тоже.
    const own = row({ assigneeId: "a-owner", idea: { ...row().idea!, createdBy: null } });
    expect(incomingFor([own], "a-owner", "")).toEqual([]);
    // А мысль руководителя владельцу — показывает.
    expect(incomingFor([row({ assigneeId: "a-owner" })], "a-owner", "")).toHaveLength(1);
  });

  it("свежие сверху; без своей строки — пусто", () => {
    const rows = [row({ id: "old" }), row({ id: "new", ideaId: "i2", createdAt: "2026-10-07T15:00:00Z" })];
    expect(incomingFor(rows, "a-igor", "u-igor").map((r) => r.id)).toEqual(["new", "old"]);
    expect(incomingFor(rows, "", "u-igor")).toEqual([]);
  });
});

describe("отправить и поделиться (0051)", () => {
  it("строка без поля kind — это «отправить»: так шло всё до 0051", () => {
    expect(sentAwayIds([row()])).toEqual(new Set(["i1"]));
  });

  it("отправленная уходит из списка автора, поделённая остаётся", () => {
    const rows = [row({ ideaId: "sent" }), row({ ideaId: "shared", kind: "share" }), row({ ideaId: "both" }), row({ ideaId: "both", kind: "share" })];
    expect([...sentAwayIds(rows)].sort()).toEqual(["both", "sent"]);
  });

  it("получателю всё равно, отправили или поделились: один список, свежее сверху", () => {
    const rows = [
      row({ id: "s", ideaId: "i-s", kind: "share", createdAt: "2026-10-22T10:00:00Z" }),
      row({ id: "o", ideaId: "i-o", createdAt: "2026-10-22T11:00:00Z" }),
    ];
    expect(incomingFor(rows, "a-igor", "u-igor").map((r) => r.id)).toEqual(["o", "s"]);
  });

  it("мысль, пришедшая и так и так, — одна строка", () => {
    const rows = [
      row({ id: "old", kind: "share", createdAt: "2026-10-22T10:00:00Z" }),
      row({ id: "new", createdAt: "2026-10-22T11:00:00Z" }),
    ];
    expect(incomingFor(rows, "a-igor", "u-igor").map((r) => r.id)).toEqual(["new"]);
  });

  it("убранная у себя и взятая в работу из поделённых уходят", () => {
    const rows = [row({ id: "gone", kind: "share", seenAt: "x" }), row({ id: "took", kind: "share", convertedTaskId: "t" })];
    expect(incomingFor(rows, "a-igor", "u-igor")).toEqual([]);
  });

  it("у поделённой молчание — не «не ответил», а «видит»", () => {
    expect(stateLabel("share", "none")).toBe("видит");
    expect(stateLabel("share", "seen")).toBe("убрал у себя");
    expect(stateLabel("send", "none")).toBe("не ответил");
    expect(stateLabel("send", "seen")).toBe("принял");
    expect(stateLabel("share", "taken")).toBe("взял в работу");
  });
});

describe("copySourceAuthor — от кого сохранённая копия", () => {
  it("автор оригинала по строке рассылки; пустой created_by — владелец", () => {
    expect(copySourceAuthor([row()], "i1")).toBe("u-manager");
    const fromOwner = row({ idea: { text: "М", createdBy: null, createdAt: "x", done: false, deletedAt: null } });
    expect(copySourceAuthor([fromOwner], "i1")).toBe("");
  });

  it("не копия или строки нет — отправителя не выдумываем", () => {
    expect(copySourceAuthor([row()], undefined)).toBeUndefined();
    expect(copySourceAuthor([row()], "other")).toBeUndefined();
    expect(copySourceAuthor([row({ idea: null })], "i1")).toBeUndefined();
  });
});

describe("takenIdeaAuthor — кто поставил задачу из мысли «себе»", () => {
  const space = "u-owner";
  it("отправленная — автор мысли: он прислал, значит поручил", () => {
    expect(takenIdeaAuthor("send", { userId: "u-manager", spaceId: space }, null)).toBe(null);
    expect(takenIdeaAuthor(null, { userId: "u-manager", spaceId: space }, "u-boss")).toBe("u-boss");
  });
  it("поделённая — сам взявший, то есть задача личная (задача 142)", () => {
    expect(takenIdeaAuthor("share", { userId: "u-manager", spaceId: space }, null)).toBe("u-manager");
  });
  it("владелец, взявший поделённую, пишется пустым, как везде", () => {
    expect(takenIdeaAuthor("share", { userId: space, spaceId: space }, "u-manager")).toBe(null);
  });
  it("без входа подписать собой нечем — остаётся автор мысли", () => {
    expect(takenIdeaAuthor("share", { userId: null, spaceId: space }, "u-boss")).toBe("u-boss");
  });
});
