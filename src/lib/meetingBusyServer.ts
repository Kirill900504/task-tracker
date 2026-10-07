import type { SupabaseClient } from "@supabase/supabase-js";
import { busyPeople } from "@/lib/meetingTime";

// Занятость людей для встречи, которую назначает СЕРВЕР — бот.
//
// Запрет двух встреч на одно время с одним человеком (07.10.2026) живёт в
// `busyPeople`, и браузер спрашивает его из уже загруженного списка. Но
// встречу назначают и из мессенджера — надиктованную владельцем и по
// времени, которое предложил участник, — и без этой проверки запрет в
// трекере обходился бы одной фразой боту. Правило то же самое; здесь
// только чтение встреч дня из базы.
//
// Отказ чтения — не повод молча назначить: пустой ответ означал бы
// «все свободны», то есть ровно то, от чего запрет защищает. Поэтому
// ошибка базы бросается, а вызывающий говорит человеку, что не вышло.
export async function busyOnServer(
  admin: SupabaseClient,
  at: { spaceId: string; date: string; time: string; durationMin: unknown; people: string[]; ignore?: string[] },
): Promise<string[]> {
  if (!at.date || !at.time || !at.people.length) return [];
  const { data, error } = await admin
    .from("meetings")
    .select("id, date, time, duration_min, status, participants")
    .eq("user_id", at.spaceId)
    .eq("date", at.date)
    .eq("status", "planned")
    .is("deleted_at", null);
  if (error) throw new Error("Не удалось проверить занятость: " + error.message);
  const rows = (data || []) as { id: string; date: string; time: string; duration_min: number | null; status: string; participants: string[] | null }[];
  return busyPeople(
    rows.map((r) => ({ id: r.id, date: r.date, time: r.time, durationMin: r.duration_min ?? 30, status: r.status, participants: r.participants || [] })),
    { date: at.date, time: at.time, durationMin: at.durationMin, people: at.people, ignore: at.ignore },
  );
}
