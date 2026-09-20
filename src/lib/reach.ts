import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig } from "@/lib/botTransport";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { ownerChats, sendToColleague } from "@/lib/botDelivery";
import { isSelfAssignee } from "@/lib/trackerRows";

// Как достучаться до человека по строке в списке людей — до ЛЮБОГО,
// включая владельца.
//
// У всех, кроме владельца, чат лежит прямо в строке `assignees`, и
// `chatsFor` берёт его оттуда. У владельца этой строки с чатом нет и не
// будет: он подключает мессенджер к своей учётной записи, и его чат живёт
// в `telegram_accounts`/`max_accounts` (кнопка «Подключить» в шапке —
// владельцева, см. правило в CLAUDE.md). Его строка в списке людей — та
// самая «Кирилл (я)» — стоит там ради имени в поле «Исполнитель», и чат у
// неё пустой.
//
// Пока поручал только владелец, разницы не было: он был отправителем, а не
// адресатом. С паритетом постановщиков (20.09.2026) он стал и адресатом
// тоже — задачу ему ставит руководитель, — и семь рассылок, написанных
// через `chatsFor`, замолчали разом: назначение, возврат на доработку,
// приёмка, перенос срока, ответ на просьбу, ступени просрочки и утренняя
// сводка «что от вас ждут». Молчали ТИХО: строка участия есть, кнопки в
// трекере работают, отказа нет — просто сообщение не уходит никуда.
//
// Поэтому «кому написать» спрашивается здесь, а не в семи местах: строка
// владельца отвечает своими чатами, чужая — своими.
export async function chatsForPerson(
  admin: SupabaseClient,
  ownerId: string,
  person: ColleagueRow,
): Promise<{ channel: BotChannelConfig; chatId: number }[]> {
  if (!isSelfAssignee(person.name)) return chatsFor(person);
  return ownerChats(admin, ownerId);
}

// Написать человеку один раз.
//
// Коллеге — в тот мессенджер, через который он подключился (первый из
// двух, см. chatsFor). Владельцу — во все, что он подключил: так уже
// устроен notifyOwner, и он читает тот, что открыт.
export async function sendToPerson(
  admin: SupabaseClient,
  ownerId: string,
  person: ColleagueRow,
  text: string,
  buttons?: BotButton[][],
): Promise<number> {
  const targets = await chatsForPerson(admin, ownerId, person);
  if (!targets.length) return 0;
  const chosen = isSelfAssignee(person.name) ? targets : targets.slice(0, 1);
  let sent = 0;
  for (const target of chosen) {
    const result = await sendToColleague(target, text, buttons);
    if (result.ok) sent++;
  }
  return sent;
}
