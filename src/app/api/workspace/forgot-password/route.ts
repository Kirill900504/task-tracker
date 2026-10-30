import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { forgotPasswordInput, readInput } from "@/lib/apiInput";
import { accountChat } from "@/lib/accountChat";
import { sendToColleague } from "@/lib/botDelivery";
import type { SupabaseClient } from "@supabase/supabase-js";
import { originOf, recoveryLink, signInLink } from "@/lib/recoveryLink";
import { findUserByEmail } from "@/lib/findUserByEmail";
import { findPeople } from "@/lib/loginPush";
import { isServiceEmail } from "@/lib/cabinet";

// «Забыли пароль?» — ссылка приходит в мессенджер, а не письмом.
//
// Письмо Supabase здесь не работает и починить его отсюда нельзя: его текст
// собирает сам Supabase, подставляя Site URL проекта, а он — localhost (см.
// recoveryLink.ts). То есть кнопка «Забыли пароль?» полгода отправляла людей
// в никуда, и заметить это мог только тот, кто её нажал и никому не сказал.
//
// Мессенджер тут лучше почты по той же причине, по которой весь этот трекер
// живёт в Telegram и MAX: бот уже привязан к человеку, привязку делал
// владелец, и человек читает его сегодня, а не когда доберётся до почты.
//
// Этот маршрут вызывается БЕЗ сессии — значит он должен стоять в списке
// исключений в src/lib/supabase/middleware.ts, иначе его перенаправит на
// /login и он ответит 405 молча.
//
// Ответ всегда один и тот же, что бы ни нашлось: по нему нельзя узнать, есть
// ли такая почта в трекере и привязан ли к ней мессенджер. Что делать, если
// ссылка не пришла, страница входа говорит сама — там это сказано один раз
// для всех случаев, а не подсказано тому, кто угадал почту.
const SAME_ANSWER = {
  ok: true,
  message: "Если эта почта есть в трекере и к ней привязан Telegram или MAX — ссылка уже там.",
};

// Сколько ссылок можно попросить на один аккаунт. Ограничение не про
// безопасность ссылки (открыть её может только хозяин чата), а про то, что
// иначе чужому человеку можно устроить сорок сообщений подряд.
// Фамилия → учётная запись. Только один подходящий человек: расплывчатой
// фамилии ссылка не уходит никому (тот же разбор, что у запроса входа в
// мессенджер, lib/loginPush). Ссылка всё равно приходит в чат самого
// человека, так что чужая фамилия отправителю ничего не даёт.
async function authIdByName(admin: SupabaseClient, who: string): Promise<string | null> {
  const people = await findPeople(admin, who);
  if (people === "vague" || people.length !== 1) return null;
  const row = people[0];
  if (/\(я\)\s*$/.test(row.name)) return row.user_id;
  const { data: member } = await admin.from("workspace_members").select("member_id").eq("assignee_id", row.id).maybeSingle();
  return (member?.member_id as string | null) || null;
}

const LIMIT = 5;
const WINDOW_SECONDS = 900;

export async function POST(req: Request) {
  const { data: body, error: badInput } = await readInput(req, forgotPasswordInput);
  if (badInput) return badInput;
  const who = body.who;

  const admin = createAdminClient();

  // Найти вход по почте — узким запросом к серверу входа, а не выкачкой
  // всех учётных записей (lib/findUserByEmail). Собственная таблица почт
  // по-прежнему не нужна: она немедленно стала бы второй правдой о том же.
  // Без собаки — это фамилия.
  const authId = who.includes("@") ? ((await findUserByEmail(admin, who))?.id ?? null) : await authIdByName(admin, who);
  if (!authId) return NextResponse.json(SAME_ANSWER);
  const { data: found } = await admin.auth.admin.getUserById(authId);
  const email = found?.user?.email || "";
  if (!email) return NextResponse.json(SAME_ANSWER);
  const user = { id: authId };

  const { count } = await admin
    .from("api_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("route", "forgot-password")
    .gte("created_at", new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString());
  if ((count ?? 0) >= LIMIT) return NextResponse.json(SAME_ANSWER);
  await admin.from("api_rate_limits").insert({ user_id: user.id, route: "forgot-password" });

  // Кому и куда — lib/accountChat: только действующему участнику, в один
  // выбранный им мессенджер. Владельцу эта дверь нужна больше всех: выдать
  // ему ссылку заново некому (тот, кто делает это остальным, — он сам).
  const target = await accountChat(admin, user.id);
  if (!target) return NextResponse.json(SAME_ANSWER);

  // Вход заведён ботом (служебная почта) — пароля у человека не было, и
  // ссылка «новый пароль» дала бы ему пароль к почте, которую он не знает.
  // Ему нужен вход: одноразовая ссылка, а пароль при желании — потом, в
  // «Личном кабинете».
  if (isServiceEmail(email)) {
    const enter = await signInLink(admin, email, originOf(req));
    if ("error" in enter) return NextResponse.json(SAME_ANSWER);
    await sendToColleague(
      target,
      `🔑 Вход в трекер — пароль не нужен:\n\n${enter.link}\n\n` +
        "Ссылка действует час и сработает один раз. Пароль для входа с почтой можно задать потом: своё имя вверху → «Личный кабинет» → «Мои данные». " +
        "Если вы ничего не просили — просто не открывайте её.",
    );
    return NextResponse.json(SAME_ANSWER);
  }

  const link = await recoveryLink(admin, email, originOf(req));
  if ("error" in link) return NextResponse.json(SAME_ANSWER);

  // Почта входа — в самом сообщении: тот, кто забыл пароль, нередко забыл
  // и под какой почтой он записан, а пришло оно в его собственный чат.
  await sendToColleague(
    target,
    `🔑 Новый пароль для трекера (вход: ${email})\n\n${link.link}\n\n` +
      "Ссылка действует час и сработает один раз. Если пароль вы не забывали — просто не открывайте её.",
  );

  return NextResponse.json(SAME_ANSWER);
}
