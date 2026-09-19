import { describe, it, expect } from "vitest";
import { isSelfAssignee, DEFAULT_ASSIGNEES } from "./trackerRows";

describe("isSelfAssignee", () => {
  it("recognises the owner's own row, and nobody else's", () => {
    expect(isSelfAssignee("Кирилл (я)")).toBe(true);
    // Trailing space is what an assignee typed by hand tends to carry.
    expect(isSelfAssignee("Кирилл (я) ")).toBe(true);
    expect(isSelfAssignee("Игорь Витковский")).toBe(false);
    expect(isSelfAssignee("")).toBe(false);
    // A colleague whose name merely mentions the letter must not be caught.
    expect(isSelfAssignee("Яна Ярцева")).toBe(false);
  });

  it("matches exactly one of the names the tracker ships with", () => {
    expect(DEFAULT_ASSIGNEES.filter(isSelfAssignee)).toEqual(["Кирилл (я)"]);
  });
});
