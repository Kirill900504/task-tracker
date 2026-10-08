import { describe, expect, it } from "vitest";
import { recapNudgeText } from "./meetingNudges";

describe("recapNudgeText", () => {
  it("names the meeting and who asked", () => {
    const text = recapNudgeText("Планёрка", "Игорь Петров", "m1");
    expect(text).toContain("«Планёрка»");
    expect(text).toContain("Игорь Петров просит подвести итог");
    expect(text).not.toContain("{title}");
  });

  it("is stable for one seed and varies across seeds", () => {
    expect(recapNudgeText("A", "X", "seed-1")).toBe(recapNudgeText("A", "X", "seed-1"));
    const variants = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => recapNudgeText("A", "X", s)));
    expect(variants.size).toBeGreaterThan(1);
  });
});
