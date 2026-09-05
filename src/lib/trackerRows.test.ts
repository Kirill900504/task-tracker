import { describe, it, expect } from "vitest";
import { sameLayout, DEFAULT_PANEL_LAYOUT } from "./trackerRows";
import type { PanelLayout } from "@/types/tracker";

describe("sameLayout", () => {
  it("treats a layout with the same content but different key order as equal", () => {
    // This is exactly what comes back from the database: panel_layout is a
    // jsonb column, and Postgres returns its keys in its own order (by
    // length: left, right, center) regardless of how they were written.
    // Comparing the two as JSON strings — the bug this replaced — made the
    // default layout look "changed" after every reload, so the "Сбросить
    // расположение" button never went away.
    const fromDatabase = {
      left: ["calPanel", "meetingsPanel"],
      right: ["ideasPanel"],
      center: ["mainCol"],
    } as PanelLayout;
    expect(JSON.stringify(fromDatabase)).not.toBe(JSON.stringify(DEFAULT_PANEL_LAYOUT));
    expect(sameLayout(fromDatabase, DEFAULT_PANEL_LAYOUT)).toBe(true);
  });

  it("spots a panel moved to another zone", () => {
    const moved: PanelLayout = { left: ["calPanel"], center: ["mainCol", "meetingsPanel"], right: ["ideasPanel"] };
    expect(sameLayout(moved, DEFAULT_PANEL_LAYOUT)).toBe(false);
  });

  it("spots panels reordered within a zone", () => {
    const reordered: PanelLayout = { left: ["meetingsPanel", "calPanel"], center: ["mainCol"], right: ["ideasPanel"] };
    expect(sameLayout(reordered, DEFAULT_PANEL_LAYOUT)).toBe(false);
  });

  it("spots a missing or extra panel", () => {
    const missing: PanelLayout = { left: ["calPanel"], center: ["mainCol"], right: ["ideasPanel"] };
    expect(sameLayout(missing, DEFAULT_PANEL_LAYOUT)).toBe(false);
  });

  it("handles a missing zone as an empty one", () => {
    const noRight = { left: ["calPanel", "meetingsPanel"], center: ["mainCol"] } as unknown as PanelLayout;
    expect(sameLayout(noRight, DEFAULT_PANEL_LAYOUT)).toBe(false);
    expect(sameLayout(noRight, { left: ["calPanel", "meetingsPanel"], center: ["mainCol"], right: [] })).toBe(true);
  });

  it("is safe with nothing to compare", () => {
    expect(sameLayout(null, null)).toBe(true);
    expect(sameLayout(null, DEFAULT_PANEL_LAYOUT)).toBe(false);
  });
});
