"use client";

// Когда данные на экране стоит перечитать — один ответ на весь трекер.
//
// Почему это вообще понадобилось. Всё живое в трекере приезжало ровно
// одним путём: подпиской realtime. Пока websocket жив, это прекрасно —
// задача, заведённая в мессенджере, появляется на доске за долю секунды.
// Но websocket не живёт вечно, и когда он умирает, НИЧЕГО не происходит:
// экран продолжает показывать вчерашний мир, кнопки работают, отказа нет.
// Слова Кирилла 22.09.2026: «веб версия тоже работает с большими
// задержками, чуть ли не обновлять приходится, чтобы подтягивались вновь
// созданные события». Обновлять и правда приходилось: F5 был единственным
// способом узнать, что в базе что-то изменилось.
//
// Умирает сокет буднично и часто: ноутбук закрыли на обед, вкладка ушла в
// фон и браузер притормозил её таймеры, сменилась сеть, wifi моргнул,
// прокси разорвал соединение по тайм-ауту бездействия. Плюс целый режим,
// в котором подписки нет ВООБЩЕ: на сети, которая не пускает к
// *.supabase.co, трекер ходит через собственный домен, а websocket туда
// не проложить (см. client.ts) — там realtime не подписывается нарочно, и
// до сегодняшнего дня это значило «данные застывают до перезагрузки».
//
// Отсюда правило: **realtime — это УСКОРИТЕЛЬ, а не источник правды.**
// Правда — это запрос к базе, и он обязан случаться сам: когда человек
// вернулся к вкладке, когда вернулась сеть, когда поднялась подписка и
// просто время от времени. Здесь описано «когда», а «что перечитать»
// знает каждый хук про себя.
//
// Слушатели окна заведены ОДНИ на всех, а не по штуке на подписчика:
// хуков пять, а карточек и окон, которые их зовут, на экране десятки.

type Reason = "visible" | "online" | "timer";

type Watcher = {
  fn: () => void;
  // Как часто перечитывать просто по времени, без всякого повода.
  everyMs: number;
  // Сколько должно пройти, чтобы повод (возврат к вкладке, сеть) сработал
  // ещё раз. Защита от очереди из событий: браузер шлёт visibilitychange и
  // focus подряд, а Alt+Tab по десять раз в минуту — обычное дело.
  minGapMs: number;
  last: number;
};

const watchers = new Set<Watcher>();
let timer: ReturnType<typeof setInterval> | null = null;

// Таймер один на всех и тикает чаще любого everyMs: у каждого подписчика
// свой срок, а проверять их дешевле, чем держать пять таймеров.
const TICK_MS = 10_000;

function fire(reason: Reason) {
  const now = Date.now();
  for (const w of [...watchers]) {
    const gap = reason === "timer" ? w.everyMs : w.minGapMs;
    if (now - w.last < gap) continue;
    w.last = now;
    try {
      w.fn();
    } catch {
      /* один сломавшийся подписчик не отменяет остальных */
    }
  }
}

function onVisible() {
  if (document.visibilityState === "visible") fire("visible");
}

function onOnline() {
  fire("online");
}

// Возврат «назад» достаёт страницу из кэша браузера целиком — вместе с
// мёртвым сокетом и состоянием той минуты, когда с неё ушли. Событие
// pageshow с persisted — единственный признак, что это случилось.
function onPageShow(e: PageTransitionEvent) {
  if (e.persisted) fire("visible");
}

function wire() {
  if (timer || typeof window === "undefined") return;
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("pageshow", onPageShow);
  timer = setInterval(() => fire("timer"), TICK_MS);
}

function unwire() {
  if (!timer) return;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("pageshow", onPageShow);
  clearInterval(timer);
  timer = null;
}

export function onRevive(fn: () => void, opts: { everyMs?: number; minGapMs?: number } = {}): () => void {
  const w: Watcher = {
    fn,
    everyMs: opts.everyMs ?? 60_000,
    minGapMs: opts.minGapMs ?? 5_000,
    // Считаем от подписки, а не от нуля: хук только что прочитал всё сам.
    last: Date.now(),
  };
  watchers.add(w);
  wire();
  return () => {
    watchers.delete(w);
    if (!watchers.size) unwire();
  };
}
