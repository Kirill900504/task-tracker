import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCallback, MENU_DATA, withMenu, screenButtons } from "./colleagues";
import { handleOwnerCallback } from "./ownerReplies";
import { taskCard } from "./colleagueQueries";

vi.mock("./selfTaskServer", () => ({ selfTaskIds: async () => new Set() }));

describe("навигация после закрытия задачи", () => {
  it("закрытая карточка для зеркала сохраняет меню и не возвращает действия", async () => {
    const chain = {
      select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: {
        role: "executor", accepted_at: null, done_at: "2026-10-30", done_comment: "Готово",
        tasks: { title: "Отчёт", status: "done", user_id: "owner", deleted_at: null },
      } }),
    };
    const admin = { from: () => chain } as unknown as SupabaseClient;
    const card = await taskCard(admin, { id: "person", name: "Игорь", user_id: "owner" }, "task", "2026-11-01", false);
    expect(card?.buttons?.flat().map((b) => b.data)).toEqual(["t:msg:task", MENU_DATA]);
  });

  it("универсальное меню владельца работает без строки «(я)» и запросов людей", async () => {
    const admin = { from: () => { throw new Error("Меню не должно искать строку человека"); } } as unknown as SupabaseClient;
    const result = await handleOwnerCallback(admin, { userId: "owner", spaceId: "owner", assigneeId: "", isOwner: true }, decodeCallback(MENU_DATA)!, "2026-11-01");
    expect(result?.sayButtons?.flat().some((b) => decodeCallback(b.data)?.action === "olist")).toBe(true);
  });

  it("не дублирует меню экрана или постановщика", () => {
    for (const rows of [screenButtons([[{ text: "Меню", data: MENU_DATA }]]), [[{ text: "Меню", data: "t:omenu:x" }]]]) {
      expect(withMenu(rows)).toBe(rows);
    }
    expect(withMenu().flat().map((b) => b.data)).toEqual([MENU_DATA]);
  });
});
