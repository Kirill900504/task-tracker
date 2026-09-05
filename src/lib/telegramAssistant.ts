import { gigaChatComplete } from "@/lib/gigachat/client";

// Answers a free-form question about the user's own tracker ("что горит?",
// "сколько задач на Никите?", "что у нас с Севастополем?") by handing the
// model a snapshot of the data (see buildTrackerContext) alongside the
// question.
//
// Read-only by construction: this path never creates, changes or deletes
// anything — those go through the quick-add/manage tools, which have their
// own confirmation rules. The worst a bad answer here can do is be wrong on
// screen, which is why the prompt is strict about not inventing items.

export async function answerTrackerQuestion(question: string, context: string): Promise<string> {
  const system = [
    "Ты — ассистент по личному таск-трекеру одного пользователя (руководителя).",
    "Ниже — СНИМОК его данных. Отвечай на вопрос, опираясь ТОЛЬКО на этот снимок.",
    "",
    "Правила:",
    "- Не выдумывай задачи, встречи, имена или даты, которых нет в снимке. Если данных не хватает — так и скажи.",
    "- Отвечай кратко и по делу, обычным человеческим языком, без markdown-разметки и без служебных заголовков.",
    "- Если уместен список — пиши простыми строками, каждая с новой строки, не больше 10 пунктов.",
    "- Считать умеешь: если спрашивают «сколько», посчитай по снимку и назови число.",
    "- Если вопрос про конкретного человека — фильтруй по полю «исп.» и по участникам встреч.",
    "- Ты только отвечаешь на вопросы. Ничего не создаёшь и не меняешь: если пользователь просит что-то сделать, скажи, что для этого нужно написать это как обычное поручение.",
    "",
    "=== СНИМОК ДАННЫХ ===",
    context,
    "=== КОНЕЦ СНИМКА ===",
  ].join("\n");

  const raw = await gigaChatComplete({ system, user: question, temperature: 0.3 });
  const answer = raw.trim();
  if (!answer) throw new Error("Пустой ответ модели");
  // Telegram rejects messages over 4096 characters.
  return answer.length > 3900 ? answer.slice(0, 3900) + "…" : answer;
}
