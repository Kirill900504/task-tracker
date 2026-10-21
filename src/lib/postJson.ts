// POST to one of our own routes and hand back its JSON — or throw.
//
// Every answer button in the tracker changes the screen BEFORE the route
// answers (lib/answerPatch, «кнопка меняет экран, а потом базу»), and
// every caller rolls the screen back when the route refuses. 21.10.2026
// Евгений Макаров wrote «закрыл задачу… думал она закрылась» about #113 —
// twice, a week apart, and there was not a single report of his in the
// database: `fetch` threw «Failed to fetch», and the throw skipped the line
// that re-reads the truth, so the optimistic «Сделал» stayed for good.
//
// The first fix rolled the screen back on a lost connection too. The same
// day Кирилл asked for the opposite and the better thing: «трекер работал и
// накапливал изменения в режиме без интернета». So a request that never
// ARRIVED is not a refusal any more — it goes to the outbox (lib/outbox),
// stays on screen and leaves by itself when the network is back; null is
// returned instead of the route's answer. `onFail` runs only on a real
// refusal, which still throws the route's reason in Russian.
import { postOrQueue, SERVER_UNREACHABLE_EVENT } from "./outbox";

export { SERVER_UNREACHABLE_EVENT };

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  opts: { fallback: string; onFail?: () => unknown | Promise<unknown> },
): Promise<T | null> {
  try {
    const result = await postOrQueue<T>(url, body, opts.fallback);
    return result.queued ? null : result.data;
  } catch (err) {
    await opts.onFail?.();
    throw err;
  }
}
