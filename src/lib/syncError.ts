// Почему не сохранилось — человеческими словами.
//
// «Не всё сохранилось в облако (1): [object Object]» — это то, что Кирилл
// увидел на экране 21.09.2026, и это ровно столько же, сколько он увидел бы
// при пустом баннере. Виновата одна строка: цепочка синхронизации бросала
// `error` Supabase как есть, а тот НЕ является Error — это обычный объект
// `{ message, details, hint, code }`. Дальше `err instanceof Error ? ... :
// String(err)` честно превращал его в «[object Object]», и единственное, что
// объясняло поломку, пропадало по дороге в базу, где эта строка и хранится
// (таблица sync_errors, её потом читает баннер).
//
// Поэтому две вещи, и обе здесь:
//   describeDbError — вытаскивает из отказа всё, что в нём есть;
//   syncFailure     — называет ещё и МЕСТО: какая таблица и что с ней
//                     делали. «duplicate key value violates unique
//                     constraint» без имени таблицы — это загадка, а с
//                     именем — половина ответа.
//
// Текст читает не разработчик: он уходит в баннер поверх доски. Значит
// сначала по-русски о том, что случилось, и только потом — слова базы,
// которые всё равно придётся переписать в чат, если чинить будем мы.

export type DbError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

// Что PostgREST на самом деле сказал. Порядок полей не случаен: `message`
// называет правило, `details` — строку, на которой оно сработало, и без
// второго первое часто не отличить от соседнего такого же.
export function describeDbError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as DbError;
    const parts = [e.message, e.details, e.hint].map((p) => (p || "").trim()).filter(Boolean);
    const code = (e.code || "").trim();
    if (parts.length) return code ? `${parts.join(" · ")} (${code})` : parts.join(" · ");
    if (code) return `код ${code}`;
  }
  // Ни слова не сказали — но сказать что-то надо, иначе баннер снова
  // окажется пустым обвинением.
  return "база отказала без объяснения";
}

// Какая таблица и что с ней делали. `what` — «запись» или «удаление»:
// отказ на удалении и отказ на записи лечатся по-разному, а выглядят
// одинаково.
export function syncFailure(table: string, what: "запись" | "удаление", err: unknown): Error {
  const failure = new Error(`${table} (${what}): ${describeDbError(err)}`);
  // Исходный отказ не выбрасываем: в консоли браузера он полезнее любого
  // нашего текста, а `cause` — то место, где его ищут.
  failure.cause = err;
  return failure;
}
