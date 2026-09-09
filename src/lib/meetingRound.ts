import { createClient } from "@/lib/supabase/client";

// Перенос встречи обнуляет голосование.
//
// Живёт отдельной функцией, а не внутри одного экрана, потому что
// перенести встречу можно двумя разными путями: поправить дату в карточке
// и перетащить её в календаре. Оба меняют один и тот же факт, и правило
// «ответ про вторник ничего не говорит про четверг» не должно зависеть от
// того, каким из них воспользовались.
//
// Прежние ответы не стираются: они остаются в своём раунде как история —
// «он и в прошлый раз не пришёл» стоит того, чтобы это было видно.
export function meetingMoved(
  before: { date: string; time?: string | null },
  after: { date: string; time?: string | null },
): boolean {
  return before.date !== after.date || (before.time || "") !== (after.time || "");
}

export async function bumpVoteRound(meetingId: string): Promise<void> {
  const db = createClient();
  const { data } = await db.from("meetings").select("vote_round").eq("id", meetingId).maybeSingle();
  const round = Number((data as { vote_round?: number } | null)?.vote_round ?? 1) || 1;
  await db.from("meetings").update({ vote_round: round + 1 }).eq("id", meetingId);
}

export async function bumpVoteRoundIfMoved(
  meetingId: string,
  before: { date: string; time?: string | null },
  after: { date: string; time?: string | null },
): Promise<boolean> {
  if (!meetingMoved(before, after)) return false;
  await bumpVoteRound(meetingId);
  return true;
}
