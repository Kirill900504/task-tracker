import { describe, it, expect } from "vitest";
import { isTaskVisible, isMeetingVisible } from "./itemVisibility";
import type { Task, Meeting } from "@/types/tracker";

const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE = "22222222-2222-2222-2222-222222222222";
const MY_ASSIGNEE = "aaaaaaaa-1111-1111-1111-111111111111";
const OTHER_ASSIGNEE = "bbbbbbbb-2222-2222-2222-222222222222";

// Задача из этих тестов пуста, кроме поля createdBy — остальные поля
// функции безразличны, а требовать заполнять Task целиком на каждый case
// значило бы прятать суть теста за вёрсткой объекта.
function task(createdBy: string): Task {
  return { createdBy } as Task;
}
function meeting(createdBy: string, participants: string[]): Meeting {
  return { createdBy, participants } as Meeting;
}

describe("видимость задачи — правило 23.09.2026: только своё, включая владельца", () => {
  it("постановщик видит то, что поставил — себе или другому", () => {
    expect(isTaskVisible(task(ME), ME, MY_ASSIGNEE, [])).toBe(true);
    expect(isTaskVisible(task(ME), ME, MY_ASSIGNEE, [OTHER_ASSIGNEE])).toBe(true);
  });

  it("владельцу принадлежит то, у чего автор не записан — как и везде в isMine", () => {
    // Та же ловушка, что уже стоила полдня: created_by у владельца пуст у
    // ВСЕГО, что он завёл. Строгая проверка здесь повторила бы ошибку,
    // из-за которой он однажды не мог закрыть собственную задачу.
    expect(isTaskVisible(task(""), "", MY_ASSIGNEE, [])).toBe(true);
  });

  it("участник — любая роль — видит чужую задачу", () => {
    // Функции всё равно, исполнитель это, соисполнитель или наблюдатель:
    // список ролей уже отфильтрован до одних только id участников, разница
    // между ролями — в том, что каждая умеет делать, а не в видимости.
    expect(isTaskVisible(task(SOMEONE), ME, MY_ASSIGNEE, [MY_ASSIGNEE])).toBe(true);
    expect(isTaskVisible(task(SOMEONE), ME, MY_ASSIGNEE, [OTHER_ASSIGNEE, MY_ASSIGNEE])).toBe(true);
  });

  it("чужая задача без моего участия не видна — включая владельцу", () => {
    expect(isTaskVisible(task(SOMEONE), ME, MY_ASSIGNEE, [])).toBe(false);
    expect(isTaskVisible(task(SOMEONE), ME, MY_ASSIGNEE, [OTHER_ASSIGNEE])).toBe(false);
    // Владелец: created_by у чужой задачи заполнен настоящим id
    // руководителя, значит это не его строка, и isMine("") его не спасает.
    expect(isTaskVisible(task(SOMEONE), "", MY_ASSIGNEE, [OTHER_ASSIGNEE])).toBe(false);
  });

  it("без своей строки участия (пустой myAssigneeId) участие не засчитывается", () => {
    // Гипотетический случай — участник без строки в assignees; список ролей
    // и так был бы пуст, но правило не должно полагаться на это молча.
    expect(isTaskVisible(task(SOMEONE), ME, "", [MY_ASSIGNEE])).toBe(false);
  });
});

describe("видимость встречи — организатор или приглашённый, по имени", () => {
  it("организатору видна своя встреча", () => {
    expect(isMeetingVisible(meeting(ME, []), ME, "Кирилл Кучеренко (я)")).toBe(true);
  });

  it("приглашённый находится по имени в списке участников", () => {
    expect(isMeetingVisible(meeting(SOMEONE, ["Иван Петров"]), ME, "Иван Петров")).toBe(true);
  });

  it("тот, кого не звали, чужую встречу не видит", () => {
    expect(isMeetingVisible(meeting(SOMEONE, ["Иван Петров"]), ME, "Анна Есина")).toBe(false);
  });

  it("пустое имя не совпадает случайно с пустой строкой в участниках", () => {
    expect(isMeetingVisible(meeting(SOMEONE, [""]), ME, "")).toBe(false);
  });
});
