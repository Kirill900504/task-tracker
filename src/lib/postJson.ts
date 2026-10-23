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

// The same request, but nobody waits for it. 23.10.2026 Кирилл about the
// report form: «на пару секунд прожимается кнопка „Отправляю…“… её вообще
// видно не должно быть». The screen already shows the answer (answerPatch),
// so making the button wait for the route's checks and writes — one to
// three seconds from fra1 — only shows the person a delay that changes
// nothing. A refusal still rolls the screen back through `onFail`, and since
// the form that sent it may be closed by then, it is announced by an event
// that the tracker turns into a toast (NewTracker), not thrown at nobody.
export const ANSWER_REFUSED_EVENT = "rokas:answer-refused";

export function postInBackground(
  url: string,
  body: Record<string, unknown>,
  opts: { fallback: string; onFail?: () => unknown | Promise<unknown>; onDone?: () => unknown },
): void {
  postJson(url, body, opts).then(
    () => void opts.onDone?.(),
    (err) => {
      const error = err instanceof Error ? err.message : opts.fallback;
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ANSWER_REFUSED_EVENT, { detail: { error } }));
    },
  );
}

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
