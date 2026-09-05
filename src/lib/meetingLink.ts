import type { SupabaseClient } from "@supabase/supabase-js";
import { stem } from "@/lib/stem";
import { moscowNow, dateStr } from "@/lib/taskLogic";

// Dictating "итоги встречи" used to only produce tasks — the meeting itself
// stayed sitting in the panel as "запланирована", and had to be closed by
// hand afterwards. This finds which meeting the story is about, so the same
// dictation can also write the outcome into its card and mark it held.
//
// Which meeting it is, is decided in code, not by the model (same rule as
// everywhere else): the candidate set is small — meetings still marked
// "planned" in the last week — and the match is a plain word-overlap between
// the story and the meeting's title/participants. Nothing is applied without
// the user's "да" either way.

const LOOKBACK_DAYS = 7;
const MIN_SCORE = 2;

export type MeetingCandidate = {
  id: string;
  title: string;
  date: string;
  time: string;
  participants: string[];
  result: string;
};

function stemsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 4) continue;
    out.add(stem(word));
  }
  return out;
}

// Later date (then later time) wins ties — the meeting you just walked out of
// is far likelier to be the one you're recapping than last Tuesday's.
function recencyKey(m: MeetingCandidate): string {
  return m.date + " " + (m.time || "");
}

export function pickMeetingForNotes(notes: string, candidates: MeetingCandidate[]): MeetingCandidate | null {
  const hay = stemsOf(notes);
  if (!hay.size) return null;

  let best: MeetingCandidate | null = null;
  let bestScore = 0;

  for (const c of candidates) {
    let score = 0;
    // A word from the title is worth more than a name: names repeat across
    // meetings, titles are what actually identifies one. A name on its own
    // still clears the bar though — «Никита пообещал прислать смету» is
    // often all a recap says about which meeting it was, and the pool it
    // picks from is only the meetings of the last week that are still open.
    for (const w of stemsOf(c.title)) if (hay.has(w)) score += 3;
    for (const p of c.participants || []) {
      for (const w of stemsOf(p)) if (hay.has(w)) score += 2;
    }
    if (score < MIN_SCORE) continue;
    if (!best || score > bestScore || (score === bestScore && recencyKey(c) > recencyKey(best))) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function shiftIso(iso: string, days: number): string {
  const base = new Date(iso + "T00:00:00Z");
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}

export async function findMeetingForNotes(
  admin: SupabaseClient,
  userId: string,
  notes: string,
  today: string = dateStr(moscowNow()),
): Promise<MeetingCandidate | null> {
  const { data } = await admin
    .from("meetings")
    .select("id,title,date,time,participants,result")
    .eq("user_id", userId)
    .eq("status", "planned")
    .is("deleted_at", null)
    .gte("date", shiftIso(today, -LOOKBACK_DAYS))
    .lte("date", today);

  const candidates: MeetingCandidate[] = (data || []).map((m) => ({
    id: m.id as string,
    title: (m.title as string) || "",
    date: (m.date as string) || "",
    time: (m.time as string) || "",
    participants: Array.isArray(m.participants) ? (m.participants as string[]) : [],
    result: (m.result as string) || "",
  }));

  return pickMeetingForNotes(notes, candidates);
}

// Keeps whatever was already written in the card and appends the recap, so a
// note typed before the meeting is never overwritten by the one dictated after.
export function mergeResult(existing: string, summary: string): string {
  const prev = (existing || "").trim();
  const next = (summary || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  return prev + "\n" + next;
}

export async function closeMeetingWithResult(
  admin: SupabaseClient,
  meetingId: string,
  existingResult: string,
  summary: string,
): Promise<string | null> {
  const { error } = await admin
    .from("meetings")
    .update({
      status: "success",
      result: mergeResult(existingResult, summary),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", meetingId);
  return error?.message || null;
}
