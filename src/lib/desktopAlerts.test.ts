import { describe, expect, it } from "vitest";
import { alertForComment, alertForNewItem, type AlertContext, type CommentRowForAlert } from "./desktopAlerts";
import type { AlertPrefs } from "./alertPrefs";

const prefs = (patch: Partial<AlertPrefs> = {}): AlertPrefs => ({ progress: true, reminders: true, quietUntil: "", muted: [], ...patch });

const ctx = (patch: Partial<AlertContext> = {}): AlertContext => ({
  myUserId: "me",
  myAssigneeId: "me-row",
  known: new Map([
    ["task:t1", { kind: "task", title: "Смета" }],
    ["meeting:m2", { kind: "meeting", title: "Планёрка" }],
  ]),
  prefs: prefs(),
  ...patch,
});

const row = (patch: Partial<CommentRowForAlert> = {}): CommentRowForAlert => ({
  id: "c1",
  item_kind: "task",
  item_id: "t1",
  body: "че скажешь?",
  system: false,
  author_user_id: "igor",
  author_assignee_id: "igor-row",
  authorName: "Евгений Макаров",
  ...patch,
});

describe("alertForComment — реплика коллеги", () => {
  it("всплывает с именем автора и местом", () => {
    const a = alertForComment(row(), ctx());
    expect(a).toMatchObject({ category: "message", title: "Евгений Макаров", kind: "task", itemId: "t1" });
    expect(a?.body).toBe("че скажешь?\nЗадача «Смета»");
  });

  it("своя реплика не всплывает — ни из трекера, ни из своего мессенджера", () => {
    expect(alertForComment(row({ author_user_id: "me" }), ctx())).toBeNull();
    expect(alertForComment(row({ author_user_id: null, author_assignee_id: "me-row" }), ctx())).toBeNull();
  });

  it("чужое обсуждение не всплывает: видимость та же, что у экрана", () => {
    expect(alertForComment(row({ item_id: "someone-elses" }), ctx())).toBeNull();
  });

  it("заглушённое обсуждение молчит, остальные нет", () => {
    const c = ctx({ prefs: prefs({ muted: ["task:t1"] }) });
    expect(alertForComment(row(), c)).toBeNull();
    expect(alertForComment(row({ item_kind: "meeting", item_id: "m2" }), c)).not.toBeNull();
  });

  it("тишина на час глушит всё, а кончившаяся — ничего", () => {
    const now = new Date("2026-10-07T18:00:00Z");
    expect(alertForComment(row(), ctx({ now, prefs: prefs({ quietUntil: "2026-10-07T18:30:00Z" }) }))).toBeNull();
    expect(alertForComment(row(), ctx({ now, prefs: prefs({ quietUntil: "2026-10-07T17:30:00Z" }) }))).not.toBeNull();
  });
});

describe("alertForComment — хроника", () => {
  it("перенос встречи всплывает один раз — по новой встрече", () => {
    const moved = alertForComment(row({ item_kind: "meeting", item_id: "m2", system: true, author_user_id: "boss", body: "📅 Перенесена с 14.10.2026, 16:00" }), ctx());
    expect(moved).toMatchObject({ category: "moved", title: "Встреча перенесена" });
    expect(moved?.body).toBe("Планёрка\nПеренесена с 14.10.2026, 16:00");
    const old = alertForComment(row({ item_kind: "meeting", item_id: "m2", system: true, body: "📅 Кирилл перенёс встречу на 15.10.2026, 16:30" }), ctx());
    expect(old).toBeNull();
  });

  it("перенос и отмена проходят сквозь заглушённое обсуждение и выключенный ход работы", () => {
    const c = ctx({ prefs: prefs({ progress: false, muted: ["meeting:m2"] }) });
    expect(alertForComment(row({ item_kind: "meeting", item_id: "m2", system: true, body: "📅 Перенесена с 14.10.2026" }), c)).not.toBeNull();
    expect(alertForComment(row({ item_kind: "meeting", item_id: "m2", system: true, body: "🚫 Игорь отменил встречу: заболел" }), c)?.title).toBe("Встреча отменена");
  });

  it("свой перенос — не новость для себя", () => {
    expect(alertForComment(row({ item_kind: "meeting", item_id: "m2", system: true, author_user_id: "me", body: "📅 Перенесена с 14.10.2026" }), ctx())).toBeNull();
  });

  it("ход работы выключается, и эмодзи из текста не уходит в окно Windows", () => {
    const r = row({ system: true, author_user_id: null, author_assignee_id: null, body: "✅ Игорь принял в работу" });
    expect(alertForComment(r, ctx())).toMatchObject({ category: "progress", title: "Задача «Смета»", body: "Игорь принял в работу" });
    expect(alertForComment(r, ctx({ prefs: prefs({ progress: false }) }))).toBeNull();
  });
});

describe("alertForNewItem", () => {
  it("называет, что пришло, и молчит в тишину", () => {
    expect(alertForNewItem({ kind: "meeting", id: "m9", title: "Обход", when: "15.10, 10:00" }, prefs())).toMatchObject({
      title: "Вас позвали на встречу",
      body: "Обход\n15.10, 10:00",
      key: "n:meeting:m9",
    });
    const now = new Date("2026-10-07T18:00:00Z");
    expect(alertForNewItem({ kind: "task", id: "t9", title: "x", when: "" }, prefs({ quietUntil: "2026-10-07T19:00:00Z" }), now)).toBeNull();
  });
});
