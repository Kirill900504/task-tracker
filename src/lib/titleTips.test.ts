import { describe, expect, it } from "vitest";
import { placeTip, TIP_EDGE, TIP_GAP } from "./titleTips";

const vp = { width: 1000, height: 800 };
const tip = { width: 120, height: 30 };

describe("placeTip", () => {
  it("встаёт над элементом по центру", () => {
    const p = placeTip({ left: 400, top: 300, width: 40, height: 40 }, tip, vp);
    expect(p).toEqual({ left: 360, top: 300 - TIP_GAP - 30, side: "above" });
  });

  it("у верхнего края уходит под элемент", () => {
    const p = placeTip({ left: 400, top: 10, width: 40, height: 30 }, tip, vp);
    expect(p.side).toBe("below");
    expect(p.top).toBe(10 + 30 + TIP_GAP);
  });

  it("у правого края прижимается к окну, а не уезжает за него", () => {
    const p = placeTip({ left: 970, top: 300, width: 28, height: 28 }, tip, vp);
    expect(p.left).toBe(vp.width - TIP_EDGE - tip.width);
  });

  it("у левого края — тоже", () => {
    expect(placeTip({ left: 0, top: 300, width: 20, height: 20 }, tip, vp).left).toBe(TIP_EDGE);
  });
});
