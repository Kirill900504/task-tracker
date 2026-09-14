import { describe, it, expect } from "vitest";
import { BOT_SETTINGS_SQL, looksLikeMissingTable, migrationFileSql } from "./ensureBotSettings";

// Одна и та же схема записана в двух местах: в файле миграции и встроенной
// строкой в коде (на Vercel каталога supabase рядом нет). Разойтись им
// нельзя — расхождение означало бы, что на боевой базе таблица не такая,
// какую проверяет npm run test:schema, и узнали бы об этом по симптому.

// Приводит SQL к списку операторов без комментариев и лишних пробелов.
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    // `comment on` — чистая документация в базе, её встроенная копия не
    // несёт: на поведение она не влияет.
    .filter((s) => !s.startsWith("comment on"));
}

describe("встроенная схема bot_settings", () => {
  it("совпадает с миграцией 0022 оператор в оператор", () => {
    const file = migrationFileSql();
    // Тесты всегда идут из корня репозитория, файл обязан находиться.
    expect(file).toBeTruthy();
    expect(statements(BOT_SETTINGS_SQL)).toEqual(statements(file!));
  });

  it("применяется повторно без вреда — иначе второе открытие страницы всё сломало бы", () => {
    for (const s of statements(BOT_SETTINGS_SQL)) {
      const safe =
        s.startsWith("create table if not exists") ||
        s.startsWith("drop policy if exists") ||
        s.startsWith("create policy") || // идёт следом за drop policy if exists
        s.startsWith("alter table") ||
        s.startsWith("revoke") ||
        s.startsWith("grant");
      expect(safe, s).toBe(true);
    }
  });
});

describe("looksLikeMissingTable", () => {
  it("узнаёт отсутствующую таблицу и по коду Postgres, и по коду PostgREST", () => {
    expect(looksLikeMissingTable({ code: "42P01" })).toBe(true);
    expect(looksLikeMissingTable({ code: "PGRST205", message: "Could not find the table in the schema cache" })).toBe(true);
  });

  it("не принимает за неё обычную ошибку прав — иначе создавали бы таблицу на каждый отказ", () => {
    expect(looksLikeMissingTable({ code: "42501", message: "permission denied for table bot_settings" })).toBe(false);
    expect(looksLikeMissingTable(null)).toBe(false);
  });
});
