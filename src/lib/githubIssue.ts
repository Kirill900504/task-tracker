// Поломка, ставшая задачей в GitHub.
//
// Зачем вообще: сообщение в мессенджер говорит Кириллу, что сломалось, — но
// починка происходит не в мессенджере. Задача в репозитории это то место,
// где я начинаю работу, и заводить её руками, пересказывая стек словами,
// бессмысленно, когда он уже записан целиком.
//
// Включается наличием токена (`GITHUB_TOKEN`). Без него всё остальное
// работает как работало: журнал пишется, сообщение уходит. Это важнее, чем
// кажется, — трекер не должен зависеть от того, настроен ли GitHub.

const REPO = process.env.GITHUB_REPO || "Kirill900504/task-tracker";

export function issueTitle(message: string): string {
  const head = message.split("\n")[0].trim();
  return "Поломка у людей: " + (head.length > 120 ? head.slice(0, 117) + "…" : head);
}

export function issueBody(input: {
  message: string;
  stack?: string | null;
  url?: string | null;
  release?: string | null;
  who?: string | null;
  fingerprint: string;
}): string {
  const lines = [
    "Пришло от самого трекера: экран сломался у человека, а не в разработке.",
    "",
    "**Ошибка**",
    "```",
    input.message.slice(0, 1000),
    "```",
  ];
  if (input.url) lines.push("", "**Страница:** " + input.url);
  if (input.release) lines.push("**Версия:** `" + input.release + "`");
  if (input.who) lines.push("**У кого:** " + input.who);
  lines.push("**Отпечаток:** `" + input.fingerprint + "`");
  if (input.stack) {
    lines.push("", "<details><summary>Стек</summary>", "", "```", input.stack.slice(0, 4000), "```", "", "</details>");
  }
  lines.push(
    "",
    "---",
    "Заведено автоматически маршрутом `/api/client-error`. Повторы той же поломки сюда не пишутся — они видны в журнале `client_errors` и по команде «ошибки» в боте.",
  );
  return lines.join("\n");
}

// Создать задачу. Возвращает её номер или null, если GitHub не настроен или
// отказал: поломка уже записана в журнал, и терять её из-за чужого сервиса
// нельзя.
export async function createCrashIssue(input: Parameters<typeof issueBody>[0]): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  try {
    const response = await fetch("https://api.github.com/repos/" + REPO + "/issues", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: issueTitle(input.message), body: issueBody(input), labels: ["поломка"] }),
    });
    if (!response.ok) return null;
    const created = (await response.json()) as { number?: number };
    return created.number ?? null;
  } catch {
    return null;
  }
}
