// POST to one of our own routes and hand back its JSON — or throw.
//
// Every answer button in the tracker changes the screen BEFORE the route
// answers (lib/answerPatch, «кнопка меняет экран, а потом базу»), and
// every caller rolls the screen back when the route refuses. What none of
// them rolled back was the request that never arrived: `fetch` throws
// «Failed to fetch» instead of returning a response, the throw skipped the
// line that re-reads the truth, and the screen kept the optimistic «Сделал»
// for good. 21.10.2026 Евгений Макаров wrote «закрыл задачу… думал она
// закрылась» about #113 — twice, a week apart, and there is not a single
// report of his in the database. Станислав Синецкий did the same on #111
// on Monday, and learned it from the overdue reminder.
//
// So the rule lives here: the caller passes `onFail`, and it runs on ANY
// failure — refusal and lost connection alike — before the error goes up.
// The error itself is Russian and says outright that nothing was sent.
import { NETWORK_TEXT } from "./humanError";

export const NOT_SENT_TEXT = `Ответ НЕ ушёл. ${NETWORK_TEXT}`;

// Lost connection is also a question about the NETWORK, not this button:
// VersionWatch hears this and checks whether the site is reachable at all.
export const SERVER_UNREACHABLE_EVENT = "rokas:server-unreachable";

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  opts: { fallback: string; onFail?: () => unknown | Promise<unknown> },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    await opts.onFail?.();
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_UNREACHABLE_EVENT));
    throw new Error(NOT_SENT_TEXT);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data || data.error) {
    await opts.onFail?.();
    throw new Error(data?.error || opts.fallback);
  }
  return data;
}
