import { afterEach, describe, expect, it, vi } from "vitest";
import { readSavedSetting, subscribeSavedSetting, writeSavedSetting } from "./savedSettings";

afterEach(() => vi.unstubAllGlobals());

describe("общие фильтры доски", () => {
  it("обновляет обе доски, изолирует аккаунты и снимает подписку", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    vi.stubGlobal("window", new EventTarget());
    const tasks = vi.fn(), work = vi.fn(), otherUser = vi.fn();
    const off = subscribeSavedSetting("user1.overdue", tasks);
    const offWork = subscribeSavedSetting("user1.overdue", work);
    const offOther = subscribeSavedSetting("user2.overdue", otherUser);
    writeSavedSetting("user1.overdue", "true");
    expect(readSavedSetting("user1.overdue")).toBe("true");
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(otherUser).not.toHaveBeenCalled();
    off();
    writeSavedSetting("user1.overdue", "false");
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(2);
    offWork(); offOther();
  });

  it("работает в сессии при запрете хранилища", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } });
    writeSavedSetting("denied.filter", "true");
    expect(readSavedSetting("denied.filter")).toBe("true");
  });

  it("получает изменения из другой вкладки", () => {
    vi.stubGlobal("window", new EventTarget());
    const notify = vi.fn();
    const off = subscribeSavedSetting("cross.filter", notify);
    const event = Object.assign(new Event("storage"), { key: "cross.filter" });
    window.dispatchEvent(event);
    expect(notify).toHaveBeenCalledTimes(1);
    off();
  });
});
