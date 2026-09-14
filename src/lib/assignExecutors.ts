import type { SupabaseClient } from "@supabase/supabase-js";
import { chatsFor, taskButtons, taskMessage, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { isSelfAssignee } from "@/lib/trackerRows";
import { isQuietHour } from "@/lib/quietHours";

// Поставить людей на задачу — серверная половина, одна на всех, кто создаёт
// задачи не из браузера.
//
// В браузере это делает assignWork.ts, и там правило сформулировано: строка
// участия и сообщение человеку живут вместе, потому что «назначил и не
// сказал» — это ровно то, ради чего трекер и затевался. На сервере этого
// одного места не было, и разошлось оно так, как расходится всегда:
//
//   * бот (botPipeline) вставлял строку и не смотрел, вставилась ли она, а
//     потом отвечал «Исполнитель: Игорь» независимо от исхода. Если имя не
//     находилось среди людей, ответ всё равно называл его — задача при этом
//     не стояла ни на ком;
//   * задачи, надиктованные списком после встречи (telegramManage), не
//     заводили строк участия вообще. В трекере такая задача выглядит
//     назначенной — на карточке имя, — а у самого человека её нет, кнопок
//     «Принял / Сделал» он не получает, и в «2 из 4» она не считается.
//
// Оба случая одинаково тихие: ошибку никто не видит, а обнаруживается это
// через неделю вопросом «почему он ничего не сделал».

export type AssignResult = {
  // Кого действительно поставили — этими именами и следует отвечать.
  attached: string[];
  // Имена, которых нет среди людей владельца. Называть их исполнителями
  // нельзя: задача на них не стоит.
  missing: string[];
  // Строки не легли в базу. Считать задачу назначенной тоже нельзя.
  error?: string;
};

async function ownerDisplayName(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("assignees").select("name").eq("user_id", userId);
  const self = ((data || []) as { name: string }[]).find((a) => isSelfAssignee(a.name));
  return self ? self.name.replace(/\(я\)\s*$/, "").trim() || "трекера" : "трекера";
}

export async function attachExecutors(
  admin: SupabaseClient,
  userId: string,
  task: { id: string; title: string; description?: string; deadline?: string | null; priority?: string },
  names: string[],
): Promise<AssignResult> {
  const wanted = [...new Set(names.map((n) => (n || "").trim()).filter(Boolean))];
  if (!wanted.length) return { attached: [], missing: [] };

  const { data } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, telegram_username, max_user_id, max_username")
    .eq("user_id", userId)
    .in("name", wanted);
  const people = (data || []) as ColleagueRow[];
  const found = new Set(people.map((p) => p.name));
  const missing = wanted.filter((n) => !found.has(n));
  if (!people.length) return { attached: [], missing };

  // Уже стоящие на задаче не дублируются: ту же задачу могут досоздать
  // второй раз, и вторая строка участия означала бы два отчёта от одного
  // человека и «1 из 2», которое никогда не станет «2 из 2».
  const { data: existing } = await admin.from("task_participants").select("assignee_id").eq("task_id", task.id);
  const already = new Set(((existing || []) as { assignee_id: string }[]).map((r) => r.assignee_id));
  const fresh = people.filter((p) => !already.has(p.id));
  if (!fresh.length) return { attached: people.map((p) => p.name), missing };

  // user_id проставляет триггер от родительской задачи (миграция 0019) —
  // отсюда его писать нельзя, строка может уехать в чужое пространство.
  const { error } = await admin
    .from("task_participants")
    .insert(fresh.map((person) => ({ task_id: task.id, assignee_id: person.id, role: "executor" })));
  if (error) return { attached: [], missing, error: error.message };

  const attached = people.map((p) => p.name);
  // Ночью трекер молчит (E2): задача придёт утренней сводкой. Строки уже
  // стоят, и человек увидит задачу, как только откроет трекер.
  if (isQuietHour()) return { attached, missing };

  const from = await ownerDisplayName(admin, userId);
  for (const person of fresh) {
    if (isSelfAssignee(person.name)) continue;
    const target = chatsFor(person)[0];
    if (!target) continue;
    await sendToColleague(target, taskMessage(task, from), taskButtons(task.id, "executor"));
  }
  return { attached, missing };
}

// То же самое для встречи, и по той же причине.
//
// У встречи два списка участников: текстовый `meetings.participants` (он
// рисуется на карточке) и строки meeting_participants (в них живут «Буду /
// Не смогу», раунды переголосования и напоминания). Строки заводились
// только при сохранении встречи из окна карточки — значит, встреча,
// созданная фразой «собери планёрку с Черкашиным», выглядела назначенной и
// не была ею: никаких кнопок, никакого «кто не ответил», никаких
// напоминаний за 2 часа. На боевой базе таких встреч оказалось 26 из 28.
export async function attachMeetingParticipants(
  admin: SupabaseClient,
  userId: string,
  meetingId: string,
  names: string[],
): Promise<AssignResult> {
  const wanted = [...new Set(names.map((n) => (n || "").trim()).filter((n) => n && !isSelfAssignee(n)))];
  if (!wanted.length) return { attached: [], missing: [] };

  const { data } = await admin.from("assignees").select("id, name").eq("user_id", userId).in("name", wanted);
  const people = (data || []) as { id: string; name: string }[];
  const found = new Set(people.map((p) => p.name));
  const missing = wanted.filter((n) => !found.has(n));
  if (!people.length) return { attached: [], missing };

  const { data: existing } = await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", meetingId);
  const already = new Set(((existing || []) as { assignee_id: string }[]).map((r) => r.assignee_id));
  const fresh = people.filter((p) => !already.has(p.id));
  if (!fresh.length) return { attached: people.map((p) => p.name), missing };

  const { error } = await admin
    .from("meeting_participants")
    .insert(fresh.map((p) => ({ meeting_id: meetingId, assignee_id: p.id, role: "participant" })));
  if (error) return { attached: [], missing, error: error.message };
  return { attached: people.map((p) => p.name), missing };
}

// Как об этом сказать постановщику. Отдельно, потому что говорят об этом
// оба вызывающих, и говорить они обязаны одинаково — в том числе про то,
// что не получилось.
export function assignNote(result: AssignResult): string {
  const parts: string[] = [];
  if (result.error) parts.push("⚠ Не удалось назначить исполнителей: " + result.error);
  if (result.missing.length) {
    parts.push(
      `⚠ Не нашёл среди людей: ${result.missing.join(", ")} — задача на них не стоит. Заведите человека в «Команде» и назначьте заново.`,
    );
  }
  return parts.length ? "\n\n" + parts.join("\n") : "";
}
