import type { BotButton } from "@/lib/botTransport";
import { encodeCallback, screenButtons } from "@/lib/colleagues";
import { miniAppUrl } from "@/lib/trackerUrl";

// Меню бота — одно на всех, сужаемое ролью.
//
// Слова Кирилла 20.09.2026: «в мессенджерах должно быть полноценное меню
// со всеми важными разделами трекера, например мысли/задачи/встречи», и
// причина, по которой это важнее мобильной вёрстки: «если люди вне офиса
// им не всегда будет кайф открывать приложения, а мессенджеры у них
// ОТКРЫТЫ ВСЕГДА».
//
// До этого меню было только у постановщика — девять кнопок. Получателю на
// то же слово приходили ДВЕ: «Мои задачи» и «Встречи». При этом выборки
// «сегодня», «просрочено», «на приёмке» у него давно работали — но
// добраться до них можно было, только угадав слово. Раздел, к которому нет
// кнопки, для человека не существует.
//
// Почему одна таблица разделов, а не два набора кнопок рядом. Половины
// бота разные по существу: постановщик смотрит на чужую работу, получатель
// отвечает за свою, и разбираются их нажатия разными функциями
// (ownerReplies против colleagueReplies). Соблазн — написать второе меню
// рядом с первым; в этом проекте вторая копия одного смысла расходилась с
// первой трижды. Здесь раздел объявлен ОДИН раз и несёт обе свои кнопки,
// поэтому добавить его половине нельзя случайно: строка таблицы либо есть,
// либо её нет, и видно это одним взглядом.
//
// Разные `data` у одного раздела — не оплошность, а то самое правило
// CLAUDE.md: кнопка живёт в том чате, который её разбирает. Владельческие
// `t:olist` понимает только половина постановщика, `t:list` — только
// половина получателя. Кнопка, попавшая не в тот чат, молчит, а молчащая
// кнопка неотличима от сломанной.

export type MenuAudience = "assigner" | "recipient";

// `app` — раздел, который не отвечает сообщением, а открывает трекер
// внутри мессенджера (см. BotButton в botTransport).
type Entry = { text: string; data: string; app?: string };

type Section = {
  // Чем раздел является для того, кто ставит задачи, и для того, кто их
  // получает. Пусто — значит этого раздела у него нет вовсе.
  assigner?: Entry;
  recipient?: Entry;
  // Раздел на всю ширину: действие, а не список. «Поручить» рядом с
  // «Люди» читается как ещё один список, которым оно не является.
  wide?: boolean;
};

const SECTIONS: Section[] = [
  {
    assigner: { text: "📋 Задачи", data: encodeCallback("task", "olist", "all") },
    recipient: { text: "📋 Мои задачи", data: encodeCallback("task", "list", "my") },
  },
  {
    assigner: { text: "📌 Сегодня", data: encodeCallback("task", "olist", "today") },
    recipient: { text: "📌 Сегодня", data: encodeCallback("task", "list", "today") },
  },
  {
    assigner: { text: "⚠ Просрочено", data: encodeCallback("task", "olist", "overdue") },
    recipient: { text: "⚠ Просрочено", data: encodeCallback("task", "list", "overdue") },
  },
  {
    // У постановщика «на приёмке» — то, что сдали ЕМУ и ждёт его решения;
    // у получателя — то, что сдал ОН и ждёт чужого. Один вопрос с двух
    // сторон, поэтому один раздел, а не два похожих.
    assigner: { text: "🔍 На приёмке", data: encodeCallback("task", "olist", "review") },
    recipient: { text: "🔍 На приёмке", data: encodeCallback("task", "list", "review") },
  },
  {
    assigner: { text: "📅 Встречи", data: encodeCallback("meeting", "olist", "all") },
    recipient: { text: "📅 Встречи", data: encodeCallback("meeting", "list", "my") },
  },
  {
    // Мысли есть только у того, кто входит в трекер, и это не забытая
    // половина, а устройство самой таблицы: у `ideas` есть `created_by`,
    // и «мои мысли» — это строки с ним. У получателя без входа нет
    // auth-id, то есть его мысль легла бы в ящик ВЛАДЕЛЬЦА и вернулась
    // бы ему чужой. Ящик «сюда пишут другие» — это не мысли, а вторая
    // очередь входящих, и заводить её, чтобы кнопка была у всех, значит
    // выдумать сущность ради симметрии меню.
    //
    // Как только человека приглашают в трекер (а Кирилл к этому и ведёт),
    // он становится постановщиком и получает этот раздел вместе с
    // остальными — отдельно ничего включать не надо.
    assigner: { text: "💡 Мысли", data: encodeCallback("idea", "olist", "all") },
  },
  { assigner: { text: "👥 Люди", data: encodeCallback("task", "olist", "people") }, wide: true },
  { assigner: { text: "➕ Поручить", data: encodeCallback("task", "new", "start") }, wide: true },
  {
    // Трекер целиком, открытый прямо в мессенджере, без пароля: подпись
    // Telegram доказывает, кто пришёл (см. /api/telegram/miniapp-auth).
    //
    // Только у постановщика, и по той же причине, что и мысли: входа у
    // получателя нет, и открывать ему нечего — страница ответила бы
    // отказом, а кнопка, ведущая к отказу, хуже отсутствующей.
    //
    // Ниже всех разделов намеренно. Всё, что выше, — ответ, который бот
    // даёт сам, не заставляя ничего открывать; трекер нужен для того,
    // чего в чате не сделать (доска, календарь, «Команда»).
    assigner: { text: "🚀 Открыть трекер", data: encodeCallback("task", "omenu", "x"), app: miniAppUrl() },
    wide: true,
  },
  {
    // Справка последней и у обоих: человек, дошедший до неё, уже не нашёл
    // нужного выше.
    assigner: { text: "❓ Помощь", data: encodeCallback("task", "olist", "help") },
    recipient: { text: "❓ Помощь", data: encodeCallback("task", "list", "help") },
  },
];

// Кнопки меню, разложенные по два в ряд. Два, а не три: в MAX подпись с
// эмодзи обрезается заметно раньше, чем в Telegram, и «⚠ Просрочено»
// превращается в «⚠ Просроч…».
export function menuButtons(who: MenuAudience): BotButton[][] {
  const rows: BotButton[][] = [];
  let pending: BotButton[] = [];
  for (const section of SECTIONS) {
    const entry = who === "assigner" ? section.assigner : section.recipient;
    if (!entry) continue;
    if (section.wide) {
      if (pending.length) {
        rows.push(pending);
        pending = [];
      }
      rows.push([entry]);
      continue;
    }
    pending.push(entry);
    if (pending.length === 2) {
      rows.push(pending);
      pending = [];
    }
  }
  if (pending.length) rows.push(pending);
  return rows;
}

// Меню — всегда экран, чем бы его ни открыли: нажатием или словом «меню».
// Поэтому его кнопки помечены здесь, а не только на обратном пути через
// handleBotCallback. Иначе меню, вызванное словом, отвечало бы новым
// сообщением — ровно тем, от чего экран и заводился.
export function botMenu(who: MenuAudience): { text: string; buttons: BotButton[][] } {
  return { text: "Что показать?", buttons: screenButtons(menuButtons(who)) };
}

// Нижний ряд под любым экраном — дверь обратно в меню.
//
// Не само меню: список, под которым висят девять кнопок, читается хуже
// самого списка. Нужен выход, а не повтор. Ряд свой у каждой половины по
// той же причине, что и меню: `data` разбирают разные функции.
export function navRow(who: MenuAudience): BotButton[][] {
  return who === "assigner"
    ? [
        [
          { text: "☰ Меню", data: encodeCallback("task", "omenu", "x") },
          { text: "📋 Задачи", data: encodeCallback("task", "olist", "all") },
        ],
      ]
    : [
        [
          { text: "☰ Меню", data: encodeCallback("task", "list", "menu") },
          { text: "📋 Мои задачи", data: encodeCallback("task", "list", "my") },
        ],
      ];
}
