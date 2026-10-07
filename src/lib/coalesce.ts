// Склеить всплеск поводов перечитать в одно чтение.
//
// Хуки участия и голосов перечитывают таблицу целиком на каждое событие
// подписки, на подъём канала и на каждый повод из lib/revive. Одно нажатие
// «Принял» — несколько событий подряд, и замер 07.10.2026 показал, что за
// одно открытие трекера участие грузилось трижды, голоса встреч — дважды,
// по 0,2 с каждый запрос на телефоне. Правило одно на все такие хуки:
//   - поводы в пределах `delayMs` — одно чтение;
//   - чтение уже идёт — после него ещё ровно одно, а не параллельное
//     (параллельные гонялись бы и отдавали экрану старое поверх нового);
//   - подъём канала вскоре после чтения ничего нового не принесёт
//     (`soonAfterStart`).
export function coalescer(run: () => Promise<void>, delayMs = 150) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let stopped = false;
  let lastStart = 0;

  async function now(): Promise<void> {
    timer = null;
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    lastStart = Date.now();
    try {
      await run();
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        soon();
      }
    }
  }

  function soon(): void {
    if (timer || stopped) return;
    timer = setTimeout(() => void now(), delayMs);
  }

  return {
    now,
    soon,
    // Было ли чтение начато меньше `ms` назад — тогда подъём канала можно
    // пропустить: всё, что он догнал бы, уже в этом чтении.
    startedWithin: (ms: number) => Date.now() - lastStart < ms,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
