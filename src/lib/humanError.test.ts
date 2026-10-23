import { describe, expect, it } from "vitest";
import { NETWORK_TEXT, humanError, isNetworkError } from "./humanError";

describe("humanError", () => {
  it("переводит сетевой обрыв любого браузера на русский", () => {
    for (const text of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(humanError(new TypeError(text), "запасной")).toBe(NETWORK_TEXT);
      expect(isNetworkError(new TypeError(text))).toBe(true);
    }
  });

  it("узнаёт обрыв в отказе Supabase, но не путает его с отказом базы", () => {
    // Ровно то, что синхронизация получила 23.10.2026 на «Люди (запись)».
    expect(isNetworkError({ message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch at sN", hint: "", code: "" })).toBe(true);
    expect(isNetworkError({ message: "new row violates row-level security policy", code: "42501" })).toBe(false);
    expect(isNetworkError({ message: "Failed to fetch", code: "PGRST000" })).toBe(false);
  });

  it("собственное сообщение оставляет как есть", () => {
    expect(humanError(new Error("Подключить можно только свой чат"), "запасной")).toBe("Подключить можно только свой чат");
  });

  it("без сообщения отдаёт запасной текст", () => {
    expect(humanError(new Error(""), "запасной")).toBe("запасной");
    expect(humanError({ code: 1 }, "запасной")).toBe("запасной");
  });
});
