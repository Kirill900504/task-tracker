import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { originOf, recoveryLink } from "@/lib/recoveryLink";

// Главное, что здесь проверяется, — ссылка ведёт НА НАШ домен.
// Готовый `action_link` от Supabase ведёт на его собственный адрес и молча
// подменяет наш redirect_to своим Site URL (у проекта это localhost), так
// что взять его «как есть» значит отправить человека в никуда. Проверка
// стоит потому, что подмена не видна ни в одном сообщении об ошибке.

function fakeAdmin(properties: Record<string, string> | null, error?: { message: string }) {
  return {
    auth: {
      admin: {
        generateLink: async () => ({ data: properties ? { properties } : null, error: error || null }),
      },
    },
  } as unknown as SupabaseClient;
}

describe("recoveryLink", () => {
  it("собирает адрес трекера с одноразовым кодом", async () => {
    const admin = fakeAdmin({ hashed_token: "abc123", action_link: "https://proj.supabase.co/auth/v1/verify?x=1" });
    const result = await recoveryLink(admin, "a@b.ru", "https://tracker.example");
    expect(result).toEqual({ link: "https://tracker.example/reset-password?token_hash=abc123" });
  });

  it("не удваивает слэш, если адрес пришёл с хвостом", async () => {
    const admin = fakeAdmin({ hashed_token: "t" });
    const result = await recoveryLink(admin, "a@b.ru", "https://tracker.example/");
    expect(result).toEqual({ link: "https://tracker.example/reset-password?token_hash=t" });
  });

  it("экранирует код, чтобы он не разломал адрес", async () => {
    const admin = fakeAdmin({ hashed_token: "a+b/c=" });
    const result = await recoveryLink(admin, "a@b.ru", "https://tracker.example");
    expect(result).toEqual({ link: "https://tracker.example/reset-password?token_hash=a%2Bb%2Fc%3D" });
  });

  it("возвращает ошибку словами, а не пустую ссылку", async () => {
    expect(await recoveryLink(fakeAdmin(null, { message: "no user" }), "a@b.ru", "https://x")).toEqual({ error: "no user" });
    // Ответ без кода — тоже отказ: иначе наружу уйдёт адрес с пустым токеном,
    // и человек увидит «ссылка не работает» вместо объяснения.
    expect(await recoveryLink(fakeAdmin({ action_link: "https://proj.supabase.co/x" }), "a@b.ru", "https://x")).toHaveProperty(
      "error",
    );
  });
});

describe("originOf", () => {
  it("верит заголовкам прокси, а не внутреннему адресу запроса", () => {
    const req = new Request("http://10.0.0.1/api/x", {
      headers: { "x-forwarded-host": "task-tracker-beta-ebon.vercel.app", "x-forwarded-proto": "https" },
    });
    expect(originOf(req)).toBe("https://task-tracker-beta-ebon.vercel.app");
  });

  it("обходится обычным host, когда прокси нет", () => {
    const req = new Request("http://example.org/api/x", { headers: { host: "example.org" } });
    expect(originOf(req)).toBe("https://example.org");
  });

  // Локальный запуск отдаёт http: иначе ссылка на `npx next start` ведёт на
  // https://localhost и не открывается ничем.
  it("на локальной машине остаётся http", () => {
    const req = new Request("http://localhost:3100/api/x", { headers: { host: "localhost:3100" } });
    expect(originOf(req)).toBe("http://localhost:3100");
  });
});
