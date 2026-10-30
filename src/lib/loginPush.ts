import type { SupabaseClient } from "@supabase/supabase-js";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { ownerChats, sendToColleague, type OwnerChat } from "@/lib/botDelivery";
import { findUserByEmail } from "@/lib/findUserByEmail";
import { normalizePhone } from "@/lib/phone";
import { checkRateLimit } from "@/lib/rateLimit";
import { LOGIN_PROMPT_TEXT, loginButtons } from "@/lib/messengerLogin";

// Запрос входа, который приходит в чат САМ (30.10.2026, его слова: «почему
// сразу не отправляет команду в ТГ, а шлёт на веб-версию? Сразу надо, чтобы
// в ТГ на доступных устройствах выдало запрос подтверждения»).
//
// Кнопка «Войти через Telegram» была ссылкой t.me с токеном, а t.me в
// браузере компьютера открывает не Telegram, а свою страницу «Start bot /
// Open in Web» — третий шаг, на котором человек и останавливался. Теперь
// окно входа спрашивает телефон или почту, а бот сам присылает вопрос в
// чат: Telegram и MAX показывают его уведомлением на всех устройствах, где
// человек вошёл. Ссылка на бота осталась запасной дорогой — для того, чей
// телефон и почта в трекер не записаны.
//
// Кому слать — решают телефон из «Моих данных» (assignees.phone) или почта
// входа. Найденному человеку уходит вопрос с числом для сверки
// (lib/messengerLogin): ввести чужой номер может кто угодно, а число на
// экране входа видит только тот, кто входит.

type Target = OwnerChat & { key: string };

// Не больше пяти запросов человеку за десять минут: иначе чужим номером
// можно устроить ему ленту уведомлений.
const PER_PERSON = 5;
const PER_PERSON_WINDOW_S = 600;

const PERSON_COLUMNS = "id, name, user_id, telegram_chat_id, max_user_id, messenger";

type PersonRow = ColleagueRow & { user_id: string };

// Чаты одной строки людей. Владелец — по метке «(я)»: его чат живёт в
// учётной записи, а не в строке (lib/reach). Отключённый доступ не получает
// ничего — тем же правилом, что и «Забыли пароль?» (lib/accountChat).
async function chatsOfRow(admin: SupabaseClient, row: PersonRow): Promise<Target[]> {
  if (row.name.trim().endsWith("(я)")) {
    return (await ownerChats(admin, row.user_id)).map((c) => ({ ...c, key: row.id }));
  }
  const { data: member } = await admin.from("workspace_members").select("status").eq("assignee_id", row.id).limit(1).maybeSingle();
  if (member?.status === "disabled") return [];
  return chatsFor(row).map((c) => ({ ...c, key: row.id }));
}

export async function loginTargets(admin: SupabaseClient, who: string): Promise<Target[]> {
  const value = who.trim();
  let rows: PersonRow[] = [];
  if (value.includes("@")) {
    const user = await findUserByEmail(admin, value);
    if (!user) return [];
    const { data: membership } = await admin.from("workspace_members").select("assignee_id").eq("member_id", user.id).limit(1).maybeSingle();
    const query = admin.from("assignees").select(PERSON_COLUMNS).is("archived_at", null);
    const { data } = membership?.assignee_id
      ? await query.eq("id", membership.assignee_id)
      : await query.eq("user_id", user.id).like("name", "%(я)");
    rows = (data || []) as PersonRow[];
  } else {
    const phone = normalizePhone(value);
    if (!phone) return [];
    const { data } = await admin.from("assignees").select(PERSON_COLUMNS).eq("phone", phone).is("archived_at", null);
    rows = (data || []) as PersonRow[];
  }
  return (await Promise.all(rows.map((row) => chatsOfRow(admin, row)))).flat();
}

// Прислать вопрос «это вы входите?» в выбранный мессенджер. Ничего не
// сообщает о том, нашёлся ли человек: ответ маршрута одинаков для всех.
export async function pushLoginRequest(
  admin: SupabaseClient,
  token: string,
  code: number,
  channel: "telegram" | "max",
  who: string,
): Promise<void> {
  const targets = (await loginTargets(admin, who)).filter((t) => t.channel.id === channel);
  await Promise.all(
    targets.map(async (target) => {
      const { allowed } = await checkRateLimit(admin, target.key, "login-push", PER_PERSON, PER_PERSON_WINDOW_S);
      if (!allowed) return;
      await sendToColleague(target, LOGIN_PROMPT_TEXT, loginButtons(token, code));
    }),
  );
}
