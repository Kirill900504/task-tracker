import { describe, it, expect } from "vitest";
import { isoDate, workdayIn } from "./whenDate";
import { resolveWhen as botWhen } from "./ownerNewTask";

// 13.10.2026: «при нажатии „завтра“ в пятницу — понедельник, а не суббота».
const FRIDAY = new Date(2026, 9, 9);
const SATURDAY = new Date(2026, 9, 10);
const SUNDAY = new Date(2026, 9, 11);
const MONDAY = new Date(2026, 9, 12);

describe("workdayIn — выходные уезжают на понедельник", () => {
  it("«завтра» в пятницу, субботу и воскресенье — понедельник", () => {
    expect(isoDate(workdayIn(FRIDAY, 1))).toBe("2026-10-12");
    expect(isoDate(workdayIn(SATURDAY, 1))).toBe("2026-10-12");
    expect(isoDate(workdayIn(SUNDAY, 1))).toBe("2026-10-12");
  });

  it("в будний день «завтра» — просто завтра", () => {
    expect(isoDate(workdayIn(MONDAY, 1))).toBe("2026-10-13");
  });

  it("«через неделю» из выходного — понедельник, из буднего — тот же день недели", () => {
    expect(isoDate(workdayIn(SATURDAY, 7))).toBe("2026-10-19");
    expect(isoDate(workdayIn(FRIDAY, 7))).toBe("2026-10-16");
  });

  it("«сегодня» не двигается даже в субботу", () => {
    expect(isoDate(workdayIn(SATURDAY, 0))).toBe("2026-10-10");
  });

  it("мастер «Поручить» в боте считает так же", () => {
    expect(botWhen("1", FRIDAY)).toBe("2026-10-12");
    expect(botWhen("0", SATURDAY)).toBe("2026-10-10");
    expect(botWhen("7", SUNDAY)).toBe("2026-10-19");
    expect(botWhen("fri", FRIDAY)).toBe("2026-10-16");
  });
});
