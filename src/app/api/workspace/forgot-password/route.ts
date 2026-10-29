import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { forgotPasswordInput, readInput } from "@/lib/apiInput";
import { accountChat } from "@/lib/accountChat";
import { sendToColleague } from "@/lib/botDelivery";
import { originOf, recoveryLink } from "@/lib/recoveryLink";
import { findUserByEmail } from "@/lib/findUserByEmail";

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
const LIMIT = 5;
const WINDOW_SECONDS = 900;

export async function POST(req: Request) {
  const { data: body, error: badInput } = await readInput(req, forgotPasswordInput);
  if (badInput) return badInput;
  const email = body.email;

  const admin = createAdminClient();

  // Найти вход по почте — узким запросом к серверу входа, а не выкачкой
  // всех учётных записей (lib/findUserByEmail). Собственная таблица почт
  // по-прежнему не нужна: она немедленно стала бы второй правдой о том же.
  const user = await findUserByEmail(admin, email);
  if (!user) return NextResponse.json(SAME_ANSWER);

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

  const link = await recoveryLink(admin, email, originOf(req));
  if ("error" in link) return NextResponse.json(SAME_ANSWER);

  await sendToColleague(
    target,
    `🔑 Новый пароль для трекера\n\n${link.link}\n\n` +
      "Ссылка действует час и сработает один раз. Если пароль вы не забывали — просто не открывайте её.",
  );

  return NextResponse.json(SAME_ANSWER);
}
