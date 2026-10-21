// Короткие таблицы рядом с задачей и встречей (чек-лист, повестка) пишет
// браузер сам: экран меняется сразу, запись идёт следом, а подписка и
// поводы догона перечитывают таблицу целиком.
//
// 21.10.2026: «нажал, а галка нажалась и сама отжалась обратно». Эхо
// подписки от ПЕРВОГО нажатия будило перечитывание, и оно приносило базу
// без второго, ещё летящего, — экран честно рисовал старое поверх нажатого.
// Тем же болела повестка: два пункта, набранные подряд, — второй исчезал на
// секунду и возвращался. И два быстрых нажатия на одну галочку могли дойти
// до базы в обратном порядке: последнее слово оставалось за сетью, а не за
// человеком.
//
// Правило отсюда одно на все такие хуки:
//   - записи идут ОДНОЙ очередью, в порядке нажатий;
//   - пока очередь не пуста, прочитанное на экран не кладётся;
//   - чтение, начатое до последней правки, выбрасывается — о ней оно не знает;
//   - очередь опустела — одно чтение, и экран сходится с базой (заодно это и
//     откат после отказа: отдельного «вернуть как было» не нужно).
export function writeQueue(onError: (message: string) => void) {
  let inFlight = 0;
  let edits = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let reread: () => void = () => {};

  return {
    // Работа очереди: вернуть текст ошибки или null.
    write(job: () => Promise<string | null>): Promise<void> {
      edits++;
      inFlight++;
      const run = queue.then(async () => {
        let message: string | null;
        try {
          message = await job();
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
        }
        if (message) onError(message);
      });
      queue = run;
      return run.finally(() => {
        inFlight--;
        if (inFlight === 0) reread();
      });
    },
    // Обернуть чтение: `apply` получит результат, только если он ещё правда.
    guard<T>(read: () => Promise<T | null>, apply: (value: T) => void, again: () => void): () => Promise<void> {
      return async () => {
        const startedAt = edits;
        const value = await read();
        if (value === null || inFlight > 0) return;
        if (edits !== startedAt) return again();
        apply(value);
      };
    },
    // Кого будить, когда очередь опустеет (перечитывание текущего экрана).
    onSettled(fn: () => void) {
      reread = fn;
    },
  };
}
