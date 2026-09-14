// Кому уходит еженедельная копия.
//
// Раньше вопрос не стоял: копия шла в Telegram, аккаунт был один, и строка
// таблицы и была получателем. С появлением MAX у одного человека стало два
// чата — и тут важно не перепутать две вещи. Выгрузка строится один раз на
// человека (она одинаковая), а отправляется в каждый его мессенджер. И
// зачистка удалённых строк — тоже один раз на человека, а не по разу на чат.
//
// Поэтому получатели сначала группируются, и только потом с ними что-то
// делают. Это единственное здесь, что стоит проверить тестом, — остальное в
// маршруте это ввод-вывод.

export type BackupChannel = "telegram" | "max";
export type BackupDestination = { channel: BackupChannel; chatId: number };

export function groupBackupTargets(
  telegram: { telegram_chat_id: number | null; user_id: string | null }[],
  max: { max_user_id: number | null; user_id: string | null }[],
): Map<string, BackupDestination[]> {
  const byUser = new Map<string, BackupDestination[]>();

  const add = (userId: string | null, channel: BackupChannel, chatId: number | null) => {
    // Строка без владельца или без чата — не получатель. Такие появляются
    // после отключения бота, и падать из-за них посреди ночного крона
    // означало бы не отправить копию всем остальным.
    if (!userId || chatId == null) return;
    const list = byUser.get(userId);
    // Один и тот же чат дважды — это один получатель: копия должна прийти
    // один раз, а не столько раз, сколько строк успело завестись.
    if (!list) byUser.set(userId, [{ channel, chatId }]);
    else if (!list.some((d) => d.channel === channel && d.chatId === chatId)) list.push({ channel, chatId });
  };

  for (const row of telegram) add(row.user_id, "telegram", row.telegram_chat_id);
  for (const row of max) add(row.user_id, "max", row.max_user_id);
  return byUser;
}
