import { isQuiet, muteKey, type AlertPrefs } from "./alertPrefs";

// Какие события всплывают окошком на ПК, и какими словами.
//
// Слова Кирилла 07.10.2026: «мне нравятся такие уведомления, хотелось бы
// чтобы они возникали и вылазили сверх открытых окон на ПК. И чтобы при
// нажатии на уведомление переходило в конкретное окно встречи… обязательно
// должны всплывать любые новые сообщения от коллег». Образец он показал
// снимком — уведомление Windows от Claude и от мессенджера: имя сверху,
// текст под ним.
//
// Источник у всех событий один — обсуждение элемента. Каждое действие,
// которое кто-то ждёт (принял, сдал, вернул, перенёс, отменил, итог), уже
// оставляет там строку хроники (lib/itemHistory), реплики коллег — тоже
// там. Значит, «что нового» — это ровно «какие строки появились в
// обсуждениях моих задач и встреч», и отдельной таблицы событий заводить
// не нужно: она стала бы третьей правдой об одном и том же.
//
// Отдельно стоит только появление НОВОЙ задачи или встречи на мне: строки
// хроники у этого нет, и узнаётся оно по тому, что элемент появился среди
// видимых (см. alertForNewItem).
//
// Здесь только решение «показывать ли и что написать» — чистыми
// функциями, с тестами. Показ, опрос и подписка — в useDesktopAlerts.

export type AlertCategory = "message" | "moved" | "progress" | "new" | "reminder";

export type DesktopAlert = {
  // Отпечаток: одно и то же событие не всплывает дважды, даже если пришло
  // и подпиской, и опросом.
  key: string;
  kind: "task" | "meeting";
  itemId: string;
  category: AlertCategory;
  title: string;
  body: string;
};

export type CommentRowForAlert = {
  id: string;
  item_kind: string;
  item_id: string;
  body: string;
  system: boolean;
  author_user_id: string | null;
  author_assignee_id: string | null;
  authorName: string;
};

export type KnownItem = { kind: "task" | "meeting"; title: string };

export type AlertContext = {
  myUserId: string;
  myAssigneeId: string | null;
  // Элементы, которые я вижу или видел в этой вкладке. Отменённая встреча
  // к моменту события уже удалена из списка — поэтому «видел», а не только
  // «вижу».
  known: Map<string, KnownItem>;
  prefs: AlertPrefs;
  now?: Date;
};

// Хроника пишет события с эмодзи в начале — в ленте это значок строки, а в
// окне Windows он стоял бы перед текстом цветной наклейкой системного
// шрифта. Срезаем его.
function plain(text: string): string {
  return text.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "").trim();
}

function oneLine(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

const where = (item: KnownItem) => (item.kind === "task" ? "Задача" : "Встреча") + " «" + item.title + "»";

export function alertForComment(row: CommentRowForAlert, ctx: AlertContext): DesktopAlert | null {
  if (row.item_kind !== "task" && row.item_kind !== "meeting") return null;
  const kind = row.item_kind;
  const item = ctx.known.get(muteKey(kind, row.item_id));
  // Чужое обсуждение: подписка и опрос приходят с правами базы, а владелец
  // по ним читает всё пространство. Видимость — та же, что у экрана.
  if (!item) return null;

  // Своё не сообщается: ни реплика, ни действие, ни ответ из своего же
  // мессенджера (там автор — моя строка в списке людей).
  if (row.author_user_id && row.author_user_id === ctx.myUserId) return null;
  if (!row.author_user_id && ctx.myAssigneeId && row.author_assignee_id === ctx.myAssigneeId) return null;

  const prefs = ctx.prefs;
  if (isQuiet(prefs, ctx.now)) return null;
  const muted = prefs.muted.includes(muteKey(kind, row.item_id));
  const base = { key: "c:" + row.id, kind, itemId: row.item_id } as const;

  if (!row.system) {
    if (muted) return null;
    const text = row.body.trim() || "📎 Файл";
    return { ...base, category: "message", title: row.authorName || "Участник", body: oneLine(text) + "\n" + where(item) };
  }

  const text = plain(row.body);
  // Перенос пишется в обе встречи: «X перенёс встречу на …» в прежнюю и
  // «Перенесена с …» в новую. Окно одно — по новой, куда человеку и идти.
  if (/перенёс встречу на/.test(text)) return null;
  if (kind === "meeting" && /^Перенесена с/.test(text)) {
    return { ...base, category: "moved", title: "Встреча перенесена", body: item.title + "\n" + oneLine(text) };
  }
  if (kind === "meeting" && /отменил встречу/.test(text)) {
    return { ...base, category: "moved", title: "Встреча отменена", body: item.title + "\n" + oneLine(text) };
  }

  if (!prefs.progress || muted) return null;
  return { ...base, category: "progress", title: where(item), body: oneLine(text) };
}

// Новая задача или встреча, которую поставил мне кто-то другой.
export function alertForNewItem(
  item: { kind: "task" | "meeting"; id: string; title: string; when: string },
  prefs: AlertPrefs,
  now?: Date,
): DesktopAlert | null {
  if (isQuiet(prefs, now)) return null;
  return {
    key: "n:" + item.kind + ":" + item.id,
    kind: item.kind,
    itemId: item.id,
    category: "new",
    title: item.kind === "task" ? "Новая задача" : "Вас позвали на встречу",
    body: item.title + (item.when ? "\n" + item.when : ""),
  };
}
