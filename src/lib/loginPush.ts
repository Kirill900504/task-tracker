import type { SupabaseClient } from "@supabase/supabase-js";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { ownerChats, sendToColleague, type OwnerChat } from "@/lib/botDelivery";
import { findUserByEmail } from "@/lib/findUserByEmail";
import { checkRateLimit } from "@/lib/rateLimit";
import { LOGIN_PROMPT_TEXT, loginButtons } from "@/lib/messengerLogin";

// Запрос входа, который приходит в чат САМ (30.10.2026, его слова: «почему
// сразу не отправляет команду в ТГ, а шлёт на веб-версию? Сразу надо, чтобы
// в ТГ на доступных устройствах выдало запрос подтверждения»).
//
// Кнопка «Войти через Telegram» была ссылкой t.me с токеном, а t.me в
// браузере компьютера открывает не Telegram, а свою страницу «Start bot /
// Open in Web» — третий шаг, на котором человек и останавливался. Теперь
// окно входа спрашивает фамилию или почту, а бот сам присылает вопрос в
// чат: Telegram и MAX показывают его уведомлением на всех устройствах, где
// человек вошёл. Ссылка на бота осталась запасной дорогой — для того, кого
// по фамилии и почте не нашли.
//
// Кому слать — решают фамилия (имя в «Команде») или почта входа. Телефона
// здесь нет нарочно (30.10.2026, его слова: «давай добавим идентификатор
// фамилию и почту, а телефон уберём, чтобы не путать людей»): он записан
// у одного человека из пятнадцати, и поле «фамилия, телефон или почта»
// обещало дорогу, которой у остальных нет. Фамилию знает о себе каждый. Найденному человеку уходит вопрос с числом для сверки
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

const MAX_NAME_MATCHES = 3;

function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\(я\)/g, " ")
    .split(/[^\p{L}-]+/u)
    .filter(Boolean);
}

// Каждое введённое слово — целое слово имени: «кучеренко» и «Кирилл
// Кучеренко» находят «Кирилл Кучеренко (я)», а «Кир» — никого.
export function nameMatches(name: string, query: string): boolean {
  const have = new Set(nameWords(name));
  const want = nameWords(query);
  return want.length > 0 && want.every((w) => have.has(w));
}

// Люди по введённому. "vague" — фамилия подошла слишком многим.
async function findPeople(admin: SupabaseClient, who: string): Promise<PersonRow[] | "vague"> {
  const value = who.trim();
  if (value.includes("@")) {
    const user = await findUserByEmail(admin, value);
    if (!user) return [];
    const { data: membership } = await admin.from("workspace_members").select("assignee_id").eq("member_id", user.id).limit(1).maybeSingle();
    const query = admin.from("assignees").select(PERSON_COLUMNS).is("archived_at", null);
    const { data } = membership?.assignee_id
      ? await query.eq("id", membership.assignee_id)
      : await query.eq("user_id", user.id).like("name", "%(я)");
    return (data || []) as PersonRow[];
  }
  // Фамилия или «Имя Фамилия» — то, что знает о себе каждый. Людей в
  // трекере десятки, поэтому выборка целиком и сравнение здесь.
  const { data } = await admin.from("assignees").select(PERSON_COLUMNS).is("archived_at", null);
  const rows = ((data || []) as PersonRow[]).filter((row) => nameMatches(row.name, value));
  // Расплывчатое («Иван») не рассылается всем Иванам сразу.
  return rows.length > MAX_NAME_MATCHES ? "vague" : rows;
}

// Что вышло — странице, словами. До 30.10.2026 маршрут отвечал «отправлено»
// всегда, чтобы по ответу нельзя было узнать, чей номер записан в трекере.
// На деле это означало, что Кирилл дважды подряд ждал запрос, которого не
// было: не нашёлся он, а экран писал «Запрос отправлен». Немое «отправлено»
// при неудаче — та же поломка, только без следов; поэтому честно, а от
// перебора защищает предел частоты по адресу в маршруте.
export type PushOutcome = "sent" | "not_found" | "vague" | "not_connected" | "too_many" | "failed";

// Прислать вопрос «это вы входите?» в выбранный мессенджер.
export async function pushLoginRequest(
  admin: SupabaseClient,
  token: string,
  code: number,
  channel: "telegram" | "max",
  who: string,
): Promise<PushOutcome> {
  const people = await findPeople(admin, who);
  if (people === "vague") return "vague";
  if (!people.length) return "not_found";
  const targets = (await Promise.all(people.map((row) => chatsOfRow(admin, row)))).flat().filter((t) => t.channel.id === channel);
  if (!targets.length) return "not_connected";
  const results = await Promise.all(
    targets.map(async (target): Promise<PushOutcome> => {
      const { allowed } = await checkRateLimit(admin, target.key, "login-push", PER_PERSON, PER_PERSON_WINDOW_S);
      if (!allowed) return "too_many";
      const sent = await sendToColleague(target, LOGIN_PROMPT_TEXT, loginButtons(token, code));
      if (!sent.ok) console.error("login push failed", channel, sent.error);
      return sent.ok ? "sent" : "failed";
    }),
  );
  return results.includes("sent") ? "sent" : results.includes("too_many") ? "too_many" : "failed";
}
