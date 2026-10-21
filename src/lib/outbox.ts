"use client";

// Ответы, которые ждут сети, — очередь, а не отказ.
//
// 21.10.2026, его слова: «надо чтоб трекер работал и накапливал изменения и
// данные в режиме без интернета! а при появлении сети снова обновлял и
// подсасывал данные». Задачи, встречи и мысли так жили давно — движок
// синхронизации держит несохранённое в IndexedDB (useTrackerData). А всё,
// что идёт через наши маршруты /api — «Принял», «Сделал», «Не могу», «Буду»,
// приёмка, возврат, итог встречи, отмена, перенос, — без связи либо
// откатывалось со словами «Ответ НЕ ушёл» (lib/postJson), либо, у
// «выстрелил и забыл» (`void fetch(...).catch(() => {})`), пропадало молча.
// В сети, которая режет `*.vercel.app` (см. CLAUDE.md), это значило «трекер
// не работает вовсе»: читать можно, отвечать нельзя.
//
// Теперь запрос, который НЕ ДОШЁЛ (fetch бросил, сервер не ответил), не
// отменяется, а ложится сюда — в localStorage, под своим auth-id, — и
// уходит сам: при возвращении сети, при возвращении к окну, раз в полминуты
// и при старте трекера. Экран при этом не откатывается: человек видит своё
// «Сделал» сразу, а хуки, которые перечитывают базу, накладывают ждущие
// ответы поверх прочитанного (`pendingPosts`), — иначе первое же
// перечитывание стёрло бы с экрана ответ, который ещё в пути.
//
// Три вещи здесь легко сломать.
// *Отказ — не связь.* Сервер, который ответил «нельзя» (400, 403, 409), уже
// всё сказал, и повторять бессмысленно: такая запись снимается и
// называется вслух (`OUTBOX_DROPPED_EVENT`). Повторяются только «не дошло»,
// 5xx, 401 (сессия обновится) и 404 — последнее чаще всего значит, что
// задача или встреча, заведённая без сети, ещё не доехала до облака:
// движок синхронизации отправит её своим ходом, и очередь подождёт. У 404
// предел попыток, чтобы ответ о правда удалённой вещи не висел вечно.
// *Порядок — порядок нажатий.* «Принял», потом «Сделал» по одной задаче —
// это два запроса, и второй без первого читается иначе. Поэтому очередь
// уходит строго по одной записи и встаёт на первой, которая не прошла.
// *Реплика в чат — вставка в базу, а не маршрут*, и у неё свой id, заданный
// здесь же: повтор вставки, которая на самом деле дошла (ответ потерялся
// по дороге), отвечает «такой id уже есть» — это и есть успех.
import { createClient } from "@/lib/supabase/client";
import { onRevive } from "@/lib/revive";

export type OutboxPost = {
  id: string;
  kind: "post";
  url: string;
  body: Record<string, unknown>;
  at: number;
  tries: number;
};

export type OutboxInsert = {
  id: string;
  kind: "insert";
  table: "item_comments";
  row: Record<string, unknown>;
  // Что сделать после вставки — рассылка реплики остальным.
  then?: { url: string; body: Record<string, unknown> };
  at: number;
  tries: number;
};

export type OutboxEntry = OutboxPost | OutboxInsert;

// Сервер отказал по существу — запись снята, человеку надо сказать, что
// именно не прошло. detail: { error: string }.
export const OUTBOX_DROPPED_EVENT = "rokas:outbox-dropped";
// Запись ушла — хукам стоит перечитать своё (detail: OutboxEntry).
export const OUTBOX_SENT_EVENT = "rokas:outbox-sent";

const KEY = "kkt_outbox";
// 404 — «ещё не доехало». Полчаса попыток раз в полминуты с запасом
// перекрывают любую синхронизацию; дальше это уже удалённая вещь.
const MAX_NOT_FOUND = 60;
const RETRY_MS = 30_000;

function myUserId(): string {
  try {
    const raw = localStorage.getItem("kkt_identity");
    return raw ? JSON.parse(raw).userId || "" : "";
  } catch {
    return "";
  }
}

// Очередь у каждого входа своя: на общем компьютере ответы одного человека
// не должны уйти от имени другого, вошедшего следом.
function storageKey(): string {
  return `${KEY}:${myUserId()}`;
}

let entries: OutboxEntry[] = [];
let loadedFor = "";
// Очередь читается из хранилища КАЖДЫЙ раз, а память — только кэш по
// строке. Две вкладки (браузер и окно на ПК рядом) иначе держали бы по
// своей копии и затирали бы записи друг друга при каждом нажатии.
let lastRaw: string | null | undefined;
const listeners = new Set<() => void>();
// Снимок для useSyncExternalStore — один и тот же массив, пока очередь не
// изменилась, иначе React перерисовывает в цикле.
let snapshot: OutboxEntry[] = [];
// Хранилище недоступно (приватный режим) — очередь живёт в памяти вкладки.
let memoryOnly = false;

function read(): OutboxEntry[] {
  if (typeof localStorage === "undefined" || memoryOnly) return entries;
  const key = storageKey();
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    memoryOnly = true;
    return entries;
  }
  if (raw === lastRaw && loadedFor === key) return entries;
  loadedFor = key;
  lastRaw = raw;
  try {
    entries = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    entries = [];
  }
  snapshot = entries;
  return entries;
}

function write(next: OutboxEntry[]) {
  entries = next;
  snapshot = next;
  if (!memoryOnly) {
    try {
      const raw = next.length ? JSON.stringify(next) : null;
      if (raw) localStorage.setItem(storageKey(), raw);
      else localStorage.removeItem(storageKey());
      lastRaw = raw;
      loadedFor = storageKey();
    } catch {
      /* переполнилось или приватный режим — очередь проживёт до закрытия вкладки */
      memoryOnly = true;
    }
  }
  for (const fn of [...listeners]) fn();
}

export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function outboxSnapshot(): OutboxEntry[] {
  read();
  return snapshot;
}

const EMPTY: OutboxEntry[] = [];
export function outboxServerSnapshot(): OutboxEntry[] {
  return EMPTY;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function enqueue(entry: OutboxEntry) {
  write([...read(), entry]);
  scheduleRetry();
}

// Ждущие запросы к одному маршруту — их накладывают поверх прочитанного
// из базы (см. начало файла).
export function pendingPosts(url: string): OutboxPost[] {
  return read().filter((e): e is OutboxPost => e.kind === "post" && e.url === url);
}

export function pendingInserts(table: OutboxInsert["table"]): OutboxInsert[] {
  return read().filter((e): e is OutboxInsert => e.kind === "insert" && e.table === table);
}

type Verdict = { ok: true; data: Record<string, unknown> } | { ok: false; retry: boolean; error: string };

function verdictOf(status: number, data: (Record<string, unknown> & { error?: string }) | null, fallback: string): Verdict {
  if (status >= 200 && status < 300 && data && !data.error) return { ok: true, data };
  const error = (data?.error as string) || fallback;
  // 401 — сессия обновится; 404 — вещь ещё едет в облако; 408/429/5xx —
  // сервер занят. Всё остальное — ответ по существу.
  const retry = status === 401 || status === 404 || status === 408 || status === 429 || status >= 500;
  return { ok: false, retry, error };
}

// Отправить один POST. null — до сервера не дошло.
async function sendPost(url: string, body: unknown, fallback: string): Promise<Verdict | null> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string }) | null;
  return verdictOf(res.status, data, fallback);
}

export const SERVER_UNREACHABLE_EVENT = "rokas:server-unreachable";

function tellUnreachable() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_UNREACHABLE_EVENT));
}

export type PostResult<T> = { queued: false; data: T } | { queued: true };

// Отправить — или, если не дошло, поставить в очередь. Отказ сервера по
// существу бросается, как раньше: его надо показать и откатить экран.
export async function postOrQueue<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<PostResult<T>> {
  // Если очередь уже не пуста, новый ответ встаёт ЗА ней, а не обгоняет:
  // «Сделал» не должен дойти раньше «Принял», нажатого без сети.
  if (read().length) {
    enqueue({ id: newId(), kind: "post", url, body, at: Date.now(), tries: 0 });
    void flushOutbox();
    return { queued: true };
  }
  const verdict = await sendPost(url, body, fallback);
  if (verdict?.ok) return { queued: false, data: verdict.data as T };
  if (!verdict || verdict.retry) {
    enqueue({ id: newId(), kind: "post", url, body, at: Date.now(), tries: 1 });
    if (!verdict) tellUnreachable();
    return { queued: true };
  }
  throw new Error(verdict.error);
}

// То же для «выстрелил и забыл»: рассылки, хроника, отметка «видел».
export function queuePost(url: string, body: Record<string, unknown>): void {
  void postOrQueue(url, body, "Не получилось").catch(() => {
    /* отказ по существу у фоновой записи показывать некому */
  });
}

// Реплика в обсуждение без связи. id задан заранее — см. начало файла.
export function queueInsert(table: OutboxInsert["table"], row: Record<string, unknown>, then?: OutboxInsert["then"]): void {
  enqueue({ id: String(row.id || newId()), kind: "insert", table, row, then, at: Date.now(), tries: 0 });
}

function isNetworkError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return !error.code && /fetch|network|load failed|timeout/i.test(error.message || "");
}

async function sendInsert(entry: OutboxInsert): Promise<Verdict | null> {
  const db = createClient();
  const { error } = await db.from(entry.table).insert(entry.row);
  if (!error || error.code === "23505") return { ok: true, data: {} };
  if (isNetworkError(error)) return null;
  // Задача, заведённая без сети, ещё не доехала — внешний ключ отказывает.
  if (/does not exist|foreign key/i.test(error.message || "")) return { ok: false, retry: true, error: error.message };
  return { ok: false, retry: false, error: error.message || "Сообщение не сохранилось" };
}

let flushing: Promise<void> | null = null;

// Две вкладки не должны отправлять одну и ту же запись дважды: отправку
// держит общий замок браузера (Web Locks), а без него — как получится,
// маршруты переносят повтор (отчёт тот же, «видел» тот же).
function exclusive(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  // request отдаёт обещание того, что вернула функция, — то есть то же самое.
  return locks ? (locks.request("rokas-outbox", fn) as unknown as Promise<void>) : fn();
}

export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = exclusive(async () => {
    try {
      for (;;) {
        const queue = read();
        const head = queue[0];
        if (!head) return;
        const verdict = head.kind === "post" ? await sendPost(head.url, head.body, "Не получилось") : await sendInsert(head);
        // Не дошло — дальше пробовать бессмысленно, сеть та же.
        if (!verdict) {
          tellUnreachable();
          return;
        }
        if (verdict.ok) {
          setServerUnreachable(false);
          write(read().filter((e) => e.id !== head.id));
          if (head.kind === "insert" && head.then) queuePost(head.then.url, head.then.body);
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OUTBOX_SENT_EVENT, { detail: head }));
          continue;
        }
        const tries = head.tries + 1;
        if (verdict.retry && tries < MAX_NOT_FOUND) {
          write(read().map((e) => (e.id === head.id ? { ...e, tries } : e)));
          return;
        }
        write(read().filter((e) => e.id !== head.id));
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(OUTBOX_DROPPED_EVENT, { detail: { error: verdict.error, entry: head } }));
          // Хуки откатят экран к правде.
          window.dispatchEvent(new CustomEvent(OUTBOX_SENT_EVENT, { detail: head }));
        }
      }
    } finally {
      flushing = null;
      scheduleRetry();
    }
  });
  return flushing;
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry() {
  if (typeof window === "undefined" || retryTimer || !read().length) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushOutbox();
  }, RETRY_MS);
}

let started = false;

// Слушатели — одни на вкладку, ставит их корень трекера.
export function startOutbox(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  // Сеть вернулась — даём движку синхронизации пару секунд отправить
  // задачи и встречи: ответы на них без самих строк получили бы 404.
  const onOnline = () => setTimeout(() => void flushOutbox(), 2500);
  window.addEventListener("online", onOnline);
  const stopRevive = onRevive(() => void flushOutbox(), { everyMs: RETRY_MS });
  // Соседняя вкладка поменяла очередь — значок и лента должны это увидеть.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== storageKey()) return;
    read();
    for (const fn of [...listeners]) fn();
  };
  window.addEventListener("storage", onStorage);
  void flushOutbox();
  return () => {
    started = false;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("storage", onStorage);
    stopRevive();
  };
}

// Достаёт ли окно до своего сервера — отвечает VersionWatch (он и так
// спрашивает /api/version), а показывает значок в шапке (ConnectionStatus)
// вместе с числом ждущих ответов: это один факт для человека — «ответы
// сейчас не уходят, но не потеряются».
let unreachable = false;

export function setServerUnreachable(next: boolean) {
  if (unreachable === next) return;
  unreachable = next;
  for (const fn of [...listeners]) fn();
  // Сервер снова отвечает — самое время отправить накопленное.
  if (!next) void flushOutbox();
}

export function serverUnreachable(): boolean {
  return unreachable;
}
