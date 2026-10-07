import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { busyOnServer } from "./meetingBusyServer";

// Бот назначает встречу мимо формы трекера, и запрет двух встреч на одно
// время обязан стоять и там. Арифметику проверяет meetingTime.test.ts;
// здесь — что запрос сужен до пространства и дня и что отказ базы не
// читается как «все свободны».

type Row = { id: string; date: string; time: string; duration_min: number | null; status: string; participants: string[] };

function fakeAdmin(rows: Row[], error: { message: string } | null = null) {
  const filters: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => ((filters[col] = val), chain),
    is: (col: string, val: unknown) => ((filters[col] = val), Promise.resolve({ data: error ? null : rows, error })),
  };
  return { admin: { from: () => chain } as unknown as SupabaseClient, filters };
}

const day = "2026-10-14";

describe("busyOnServer", () => {
  it("находит занятого и спрашивает только своё пространство, этот день и назначенные", async () => {
    const { admin, filters } = fakeAdmin([{ id: "a", date: day, time: "16:00", duration_min: 30, status: "planned", participants: ["Наталья Есина"] }]);
    const busy = await busyOnServer(admin, { spaceId: "space-1", date: day, time: "16:00", durationMin: 30, people: ["Наталья Есина"] });
    expect(busy).toEqual(["Наталья Есина"]);
    expect(filters).toMatchObject({ user_id: "space-1", date: day, status: "planned", deleted_at: null });
  });

  it("встреча без длительности в базе считается получасовой", async () => {
    const { admin } = fakeAdmin([{ id: "a", date: day, time: "16:00", duration_min: null, status: "planned", participants: ["Есина"] }]);
    expect(await busyOnServer(admin, { spaceId: "s", date: day, time: "16:30", durationMin: 30, people: ["Есина"] })).toEqual([]);
    expect(await busyOnServer(admin, { spaceId: "s", date: day, time: "15:30", durationMin: 60, people: ["Есина"] })).toEqual(["Есина"]);
  });

  it("переносимая встреча сама себе не мешает", async () => {
    const { admin } = fakeAdmin([{ id: "a", date: day, time: "16:00", duration_min: 30, status: "planned", participants: ["Есина"] }]);
    expect(await busyOnServer(admin, { spaceId: "s", date: day, time: "16:00", durationMin: 30, people: ["Есина"], ignore: ["a"] })).toEqual([]);
  });

  it("отказ базы — ошибка, а не «все свободны»", async () => {
    const { admin } = fakeAdmin([], { message: "timeout" });
    await expect(busyOnServer(admin, { spaceId: "s", date: day, time: "16:00", durationMin: 30, people: ["Есина"] })).rejects.toThrow("timeout");
  });
});
