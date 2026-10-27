import { describe, expect, it } from "vitest";
import { isStillProcessing } from "@/lib/max";

describe("isStillProcessing — MAX is still digesting an uploaded file", () => {
  it("waits on both names MAX uses for it", () => {
    expect(isStillProcessing("attachment.not.ready")).toBe(true);
    // The exact text that reached the owner's chat on 26.10.2026.
    expect(isStillProcessing("Key: errors.process.attachment.file.not.processed")).toBe(true);
  });

  it("does not wait on a real refusal", () => {
    expect(isStillProcessing("chat.not.found")).toBe(false);
    expect(isStillProcessing("HTTP 403")).toBe(false);
  });
});
