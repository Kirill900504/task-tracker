import { describe, it, expect } from "vitest";
import type { Idea } from "@/types/tracker";
import { ideaCreated, ideasToReview, isReviewDay, reviewWeek } from "./ideaReview";

const idea = (id: string, createdAt: string, over: Partial<Idea> = {}): Idea => ({ id, text: id, important: false, done: false, createdAt, doneAt: "", ...over });
const friday = new Date(2026, 9, 9, 10, 0); // пятница, 09.10.2026

describe("разбор мыслей раз в неделю", () => {
  it("читает дату мысли в том виде, в каком она показывается", () => {
    expect(ideaCreated("01.10.2026 17:26")?.getDate()).toBe(1);
    expect(ideaCreated("мусор")).toBeNull();
  });

  it("строка разбора — с пятницы по воскресенье", () => {
    expect(isReviewDay(friday)).toBe(true);
    expect(isReviewDay(new Date(2026, 9, 11))).toBe(true); // вс
    expect(isReviewDay(new Date(2026, 9, 12))).toBe(false); // пн
  });

  it("неделя — по понедельнику: пятница и следующее воскресенье — одна неделя", () => {
    expect(reviewWeek(friday)).toBe("2026-10-05");
    expect(reviewWeek(new Date(2026, 9, 11))).toBe("2026-10-05");
  });

  it("берёт свои живые мысли старше недели, старые первыми, без оставленных", () => {
    const list = [
      idea("свежая", "05.10.2026 10:00"),
      idea("старая", "01.09.2026 10:00"),
      idea("средняя", "20.09.2026 10:00"),
      idea("вычеркнутая", "01.09.2026 10:00", { done: true }),
      idea("чужая", "01.09.2026 10:00", { createdBy: "x" }),
      idea("оставлена", "01.09.2026 10:00"),
    ];
    const got = ideasToReview(list, friday, new Set(["оставлена"]), (i) => !i.createdBy);
    expect(got.map((i) => i.id)).toEqual(["старая", "средняя"]);
  });
});
