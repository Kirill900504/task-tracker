import { describe, it, expect, vi, afterEach } from "vitest";
import { isRussianWorkingDay } from "./workCalendar";

// Each test uses a distinct date so the module's per-date cache never carries
// an answer between them.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockCalendar(body: string, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok, text: async () => body }) as unknown as typeof fetch;
}

describe("isRussianWorkingDay", () => {
  it('treats "0" (обычный рабочий день) as a working day', async () => {
    mockCalendar("0");
    expect(await isRussianWorkingDay(new Date(2031, 0, 9))).toBe(true);
  });

  it('treats "1" (нерабочий) as a day off — even on a weekday', async () => {
    mockCalendar("1");
    // 2031-01-02 is a Thursday: only the calendar knows it's a holiday.
    expect(await isRussianWorkingDay(new Date(2031, 0, 2))).toBe(false);
  });

  it('treats "2" (сокращённый предпраздничный) as a working day', async () => {
    mockCalendar("2");
    expect(await isRussianWorkingDay(new Date(2031, 1, 21))).toBe(true);
  });

  it('treats "4" (рабочий день, перенесённый с выходного) as a working day', async () => {
    mockCalendar("4");
    // A Saturday that the calendar has turned into a working day.
    expect(await isRussianWorkingDay(new Date(2031, 2, 8))).toBe(true);
  });

  it("falls back to the weekday when the service fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await isRussianWorkingDay(new Date(2031, 3, 5))).toBe(false); // Saturday
    expect(await isRussianWorkingDay(new Date(2031, 3, 7))).toBe(true); // Monday
  });

  it("falls back to the weekday on an unexpected response body", async () => {
    mockCalendar("<html>maintenance</html>");
    expect(await isRussianWorkingDay(new Date(2031, 4, 10))).toBe(false); // Sunday
  });

  it("only asks the service once per date", async () => {
    mockCalendar("0");
    const date = new Date(2031, 5, 16);
    await isRussianWorkingDay(date);
    await isRussianWorkingDay(date);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
