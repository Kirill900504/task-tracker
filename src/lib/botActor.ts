import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";

// Кто говорит из этого чата — и с какими правами.
//
// Половина бота, которой пользуется ПОСТАНОВЩИК (принять работу, вернуть,
// продлить срок, напомнить, открыть заново, поручить, списки, меню), была
// привязана к чату владельца: нажатие искало строку в `telegram_accounts`
// / `max_accounts`, и у руководителя её нет — его чат живёт на строке
// человека. То есть четырнадцать человек могли отвечать по своим задачам,
// но не могли принять работу по тем, что поставили сами: за этим надо было
// идти в трекер.
//
// Слова Кирилла 20.09.2026: «надо чтоб каждый человек мог принять работу
// из мессенджера и делать любые манипуляции, так как сейчас мы делаем
// абсолютно равноправный для всех постановщик задач». Это и есть правило:
// постановщик — это роль по задаче, а не место в системе, и бот обязан
// считать права так же, как их считают маршруты трекера, — по `created_by`,
// а не по тому, в какой таблице лежит чат.
//
// Поэтому вместо «владелец или нет» у бота теперь есть актор:
//
//   userId  — настоящий auth-id нажавшего. Им и сверяется `created_by`.
//   spaceId — чьё пространство: под этим `user_id` лежат все строки.
//   isOwner — видит в пространстве всё; у остальных видимое сужается до
//             своего авторства.
//
// Чего актор НЕ даёт: прав, которых нет в базе. Политики (миграции 0019,
// 0023, 0031) остаются единственной настоящей границей, а это — та же
// граница, показанная человеку заранее, чтобы он не упёрся в молчаливый
// отказ.

export type BotActor = {
  userId: string;
  spaceId: string;
  // Строка в списке людей. У руководителя — та, к которой привязано
  // членство; у владельца пусто (его строка ищется по метке «(я)» и здесь
  // не нужна).
  assigneeId: string;
  isOwner: boolean;
};

// Найти актора по чату.
//
// Порядок проверок обратен привычному: сперва таблица аккаунтов
// (владелец), потом строка человека плюс членство (руководитель). Один и
// тот же чат не может быть и тем и другим — подключение разводит их с
// самого начала, — а если вдруг окажется, права владельца старше.
export async function findActorByChat(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
): Promise<BotActor | null> {
  const { data: account } = await admin
    .from(channel.accountsTable)
    .select("user_id")
    .eq(channel.chatColumn, chatId)
    .limit(1)
    .maybeSingle();
  const ownerRow = account as { user_id: string } | null;
  if (ownerRow) {
    return { userId: ownerRow.user_id, spaceId: ownerRow.user_id, assigneeId: "", isOwner: true };
  }

  const { data: person } = await admin
    .from("assignees")
    .select("id, user_id")
    .eq(channel.chatColumn, chatId)
    .limit(1)
    .maybeSingle();
  const row = person as { id: string; user_id: string } | null;
  if (!row) return null;

  // Членство — это вход в трекер. Получатель задач без входа постановщиком
  // быть не может: у него нет ни своих задач, ни auth-id, которым можно
  // подписать решение. Он остаётся тем, кем был, — человеком, которому
  // пишут, и его половина бота (принял / сделал / не могу) работает как
  // работала.
  const { data: member } = await admin
    .from("workspace_members")
    .select("member_id, owner_id, status")
    .eq("assignee_id", row.id)
    .eq("status", "active")
    .maybeSingle();
  const membership = member as { member_id: string | null; owner_id: string } | null;
  if (!membership?.member_id) return null;

  return { userId: membership.member_id, spaceId: membership.owner_id, assigneeId: row.id, isOwner: false };
}

// Сузить выборку до того, что человеку принадлежит.
//
// Владелец отвечает за пространство и видит в нём всё; остальные — только
// то, что поставили сами. Одна функция на все выборки половины
// постановщика: раньше это было бы четырнадцать одинаковых `.eq()`, и
// пропущенный означал бы не «лишняя строка в списке», а чужую задачу,
// которую можно закрыть.
// Отдаётся набором колонок для `.match()`, а не обёрткой над запросом:
// обёртка обязана возвращать тот же тип, что приняла, а типы PostgREST
// рекурсивны настолько, что TypeScript на такой обёртке сдаётся вслух
// («type instantiation is excessively deep»). Набор полей тот же самый и
// читается лучше.
export function actorScope(actor: BotActor): Record<string, string> {
  return actor.isOwner ? { user_id: actor.spaceId } : { user_id: actor.spaceId, created_by: actor.userId };
}
