import { describe, it, expect } from "vitest";
import { isMine, isCreatedByMe } from "./ownership";

const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE = "22222222-2222-2222-2222-222222222222";

describe("своё или чужое", () => {
  it("владельцу принадлежит всё, включая то, у чего автор не записан", () => {
    // Это и есть ошибка, ради которой функция появилась: у владельца
    // created_by пуст у ВСЕГО, что он завёл, — колонка не помечает его
    // собственные строки. Сравнение с его настоящим id объявляло чужой всю
    // его работу, и он не мог закрыть собственную задачу.
    expect(isMine({ createdBy: "" }, "")).toBe(true);
    expect(isMine({ createdBy: SOMEONE }, "")).toBe(true);
    expect(isMine(null, "")).toBe(true);
  });

  it("руководителю своё — то, что он поставил сам", () => {
    expect(isMine({ createdBy: ME }, ME)).toBe(true);
    expect(isMine({ createdBy: SOMEONE }, ME)).toBe(false);
  });

  it("задача без автора руководителю чужая", () => {
    // Пустой created_by у руководителя означает «завёл кто-то другой,
    // давно»: свои строки помечаются при создании.
    expect(isMine({ createdBy: "" }, ME)).toBe(false);
    expect(isMine({}, ME)).toBe(false);
  });

  it("пустой предмет не ломает правило", () => {
    // Новая задача, которую ещё не открыли: решать нечего, запрещать нечего.
    expect(isMine(null, ME)).toBe(true);
    expect(isMine(undefined, ME)).toBe(true);
  });
});

describe("isCreatedByMe — авторство, а не право редактировать", () => {
  it("владельцу СВОЁ — только то, у чего created_by и правда пуст", () => {
    // Ключевое отличие от isMine(): владельца здесь не спасает пустой
    // myUserId — сравнение всегда буквальное.
    expect(isCreatedByMe({ createdBy: "" }, "")).toBe(true);
    expect(isCreatedByMe({}, "")).toBe(true);
  });

  it("владельцу задача руководителя — НЕ своё, даже если isMine сказала бы «моё»", () => {
    // Ровно тот баг, который поймал itemVisibility.test.ts: isMine(x, "")
    // возвращает true для чего угодно, а isCreatedByMe — нет.
    expect(isCreatedByMe({ createdBy: SOMEONE }, "")).toBe(false);
  });

  it("руководителю своё — то же, что и у isMine", () => {
    expect(isCreatedByMe({ createdBy: ME }, ME)).toBe(true);
    expect(isCreatedByMe({ createdBy: SOMEONE }, ME)).toBe(false);
    expect(isCreatedByMe({ createdBy: "" }, ME)).toBe(false);
  });

  it("пустой предмет считается своим — решать нечего", () => {
    expect(isCreatedByMe(null, ME)).toBe(true);
    expect(isCreatedByMe(undefined, ME)).toBe(true);
  });
});
