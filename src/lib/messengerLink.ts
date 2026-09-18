// Правила экрана «подключи себе бота», вынутые из разметки, чтобы их можно
// было проверить без браузера.
//
// Правило одно, и стоило оно жалобы «не работает кнопка»: выданный код
// показывается ровно до тех пор, пока НЕ подключён ТОТ канал, для которого
// он выдан. Оба слова важны:
//
//   — «тот»: человек может сидеть в MAX и подключать Telegram, и код
//     Telegram обязан остаться на экране;
//   — «пока не подключён»: как только канал подключился, блок исчезает сам.
//     Иначе получается то, что получилось у Евгения Макарова — он уже был
//     подключён, жал «Готово, проверить», проверка проходила честно и не
//     меняла на экране ничего. Кнопка, которая ничего не делает, и кнопка,
//     после которой ничего не видно, — для нажавшего одно и то же.

export type MessengerChannel = "telegram" | "max";

export type LinkedNow = { telegram: boolean; max: boolean };

export function showCode(pendingChannel: MessengerChannel | null, linked: LinkedNow): boolean {
  if (!pendingChannel) return false;
  return !linked[pendingChannel];
}

// Что сказать после нажатия «Готово, проверить». Без канала (общая кнопка
// «Проверить») ответ про любой из двух: там человек ничего не подключает
// прямо сейчас, он просто спрашивает, не появилось ли подключение вообще.
export function checkedButNotLinked(pendingChannel: MessengerChannel | null, linked: LinkedNow): boolean {
  if (!pendingChannel) return !linked.telegram && !linked.max;
  return !linked[pendingChannel];
}
