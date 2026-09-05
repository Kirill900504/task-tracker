import type { SupabaseClient } from "@supabase/supabase-js";
import { gigaChatComplete } from "@/lib/gigachat/client";

// "Найди всё про Севастополь" — across tasks, meetings, ideas, and the parts
// the assistant's normal snapshot deliberately leaves out: task descriptions
// and meeting outcome notes. That is where half of what you'd search for
// actually lives ("Сергей сказал, что поставка займёт 14 дней").
//
// Matching is done in code, not by the model: it searches word stems, so
// "Севастополь" also finds "Севастополю"/"севастопольский". Only the rows
// that matched are then handed to the model to summarise, which keeps both
// the token bill and the amount of data leaving the app proportional to the
// question.

const MAX_HITS_PER_KIND = 15;

export type SearchHit = { kind: "task" | "meeting" | "idea"; line: string };

// Strips the common Russian endings so a query matches its own inflections.
// Crude on purpose — a stem that is slightly too short only widens the net,
// and the results are shown to a human either way.
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  return w.replace(/(ами|ями|ого|ему|ому|ыми|ими|ая|ое|ые|ий|ый|ой|ем|ом|ах|ях|ов|ев|ей|ю|я|ы|и|а|е|у|о)$/u, "");
}

function queryStems(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    // Words that carry no meaning for a search — without this "что там по
    // опту" matches everything containing "там".
    .filter((w) => !["что", "как", "где", "все", "всё", "про", "най", "найди", "покажи", "там", "или", "для", "мне", "был", "было"].includes(w))
    .map(stem)
    .filter((s) => s.length >= 3);
}

function matches(text: string | null | undefined, stems: string[]): boolean {
  if (!text) return false;
  const hay = text.toLowerCase();
  return stems.some((s) => hay.includes(s));
}

export async function searchTracker(admin: SupabaseClient, userId: string, query: string): Promise<SearchHit[]> {
  const stems = queryStems(query);
  if (!stems.length) return [];

  const [taskRes, meetingRes, ideaRes] = await Promise.all([
    admin.from("tasks").select("title,description,assignee,status,deadline").eq("user_id", userId).is("deleted_at", null),
    admin.from("meetings").select("title,date,time,participants,status,result").eq("user_id", userId).is("deleted_at", null),
    admin.from("ideas").select("text,done,created_at").eq("user_id", userId).is("deleted_at", null),
  ]);

  const hits: SearchHit[] = [];

  for (const t of (taskRes.data || []).slice(0, 500)) {
    if (!matches([t.title, t.description, t.assignee].join(" "), stems)) continue;
    const bits = [t.assignee, t.deadline ? "срок " + t.deadline : "", t.status === "done" ? "завершена" : ""].filter(Boolean);
    hits.push({ kind: "task", line: `задача: ${t.title}${bits.length ? " (" + bits.join(", ") + ")" : ""}${t.description ? " — " + String(t.description).slice(0, 200) : ""}` });
    if (hits.filter((h) => h.kind === "task").length >= MAX_HITS_PER_KIND) break;
  }

  for (const m of (meetingRes.data || []).slice(0, 500)) {
    const participants = Array.isArray(m.participants) ? m.participants.join(" ") : "";
    if (!matches([m.title, m.result, participants].join(" "), stems)) continue;
    const outcome = m.status === "success" ? "успешно" : m.status === "no_result" ? "без результата" : "запланирована";
    hits.push({
      kind: "meeting",
      line: `встреча ${m.date}${m.time ? " " + m.time : ""}: ${m.title} (${outcome})${m.result ? " — итог: " + String(m.result).slice(0, 200) : ""}`,
    });
    if (hits.filter((h) => h.kind === "meeting").length >= MAX_HITS_PER_KIND) break;
  }

  for (const i of (ideaRes.data || []).slice(0, 500)) {
    if (!matches(i.text, stems)) continue;
    hits.push({ kind: "idea", line: `мысль: ${String(i.text).slice(0, 250)}${i.done ? " (отмечена)" : ""}` });
    if (hits.filter((h) => h.kind === "idea").length >= MAX_HITS_PER_KIND) break;
  }

  return hits;
}

export async function summariseSearch(query: string, hits: SearchHit[]): Promise<string> {
  if (!hits.length) return `По запросу «${query}» ничего не нашёл — ни в задачах, ни во встречах, ни в мыслях.`;

  const listing = hits.map((h) => "- " + h.line).join("\n");
  // Short result sets read better raw than paraphrased, and cost nothing.
  if (hits.length <= 3) return `Нашёл по запросу «${query}»:\n${listing}`;

  const system = [
    "Ты помощник по личному таск-трекеру. Ниже — всё, что нашлось в трекере по запросу пользователя.",
    "Кратко перескажи, что есть по теме: сгруппируй по смыслу, начни с самого важного.",
    "",
    "Правила:",
    "- Пиши только про то, что есть в списке. Ничего не додумывай.",
    "- Не переписывай список целиком дословно — дай понятную выжимку, до 10 строк.",
    "- Без markdown и заголовков.",
    "",
    "=== НАЙДЕНО ===",
    listing,
    "=== КОНЕЦ ===",
  ].join("\n");

  try {
    const raw = await gigaChatComplete({ system, user: query, temperature: 0.3 });
    const text = raw.trim();
    if (text) return `Нашёл по запросу «${query}» (${hits.length}):\n${text}`;
  } catch {
    // fall through to the plain listing
  }
  return `Нашёл по запросу «${query}» (${hits.length}):\n${listing}`;
}
