import { describe, it, expect } from "vitest";
import { actorScope, authorFilter, type BotActor } from "./botActor";

// Граница пространства в боте держится на одной функции, и цена ошибки в
// ней несимметрична: лишний фильтр даёт пустой список, пропущенный —
// выдаёт чужие данные. Ровно это и случилось 20.09.2026, когда вместо
// актора в неё приехала строка с id: `.match()` выбросил ключи со
// значением `undefined`, и запрос ушёл без единого условия.
//
// Поэтому проверяется не только «что она возвращает», но и «что она
// отказывается работать вслепую».

const owner: BotActor = { userId: "u1", spaceId: "u1", assigneeId: "", isOwner: true };
const manager: BotActor = { userId: "u2", spaceId: "u1", assigneeId: "a2", isOwner: false };

describe("actorScope", () => {
  it("владельцу — всё пространство", () => {
    expect(actorScope(owner)).toEqual({ user_id: "u1" });
  });

  it("остальным — только своё авторство внутри пространства", () => {
    expect(actorScope(manager)).toEqual({ user_id: "u1", created_by: "u2" });
  });

  it("падает, если актора нет вовсе", () => {
    expect(() => actorScope(undefined as unknown as BotActor)).toThrow();
  });

  it("падает на голой строке вместо актора — именно так и утекло", () => {
    // `any` здесь не для удобства теста, а воспроизведение причины:
    // поле из Supabase приходит без типа, и строка проезжает молча.
    expect(() => actorScope("u1" as unknown as BotActor)).toThrow();
  });

  it("падает на акторе без пространства", () => {
    expect(() => actorScope({ ...manager, spaceId: "" })).toThrow();
  });

  it("падает на не-владельце без своего id: иначе он увидел бы всё", () => {
    expect(() => actorScope({ ...manager, userId: "" })).toThrow();
  });
});

// Равные права (06.10.2026): у владельца в боте нет поблажки на чужую
// работу. Пространство у него по-прежнему своё целиком (actorScope), но
// решать он может только то, у чего автор не записан, — свои строки.
describe("authorFilter", () => {
  it("владельцу — только свои строки (автор не записан)", () => {
    expect(authorFilter(owner)).toBe("created_by.is.null");
  });

  it("руководителю — то же правило, что и в actorScope", () => {
    expect(authorFilter(manager)).toBe("created_by.eq.u2");
  });

  it("падает вслепую, как и actorScope", () => {
    expect(() => authorFilter("u1" as unknown as BotActor)).toThrow();
    expect(() => authorFilter({ ...manager, userId: "" })).toThrow();
  });
});