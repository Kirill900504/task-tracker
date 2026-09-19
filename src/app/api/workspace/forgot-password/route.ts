import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { originOf, recoveryLink } from "@/lib/recoveryLink";

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
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "Укажите почту" }, { status: 400 });

  const admin = createAdminClient();

  // Найти вход по почте. Отдельного поиска в auth у SDK нет, а людей здесь
  // десятки — перебор одной страницы дешевле собственной таблицы почт,
  // которая немедленно стала бы второй правдой о том же самом.
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (users?.users || []).find((u) => (u.email || "").toLowerCase() === email);
  if (!user) return NextResponse.json(SAME_ANSWER);

  const { count } = await admin
    .from("api_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("route", "forgot-password")
    .gte("created_at", new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString());
  if ((count ?? 0) >= LIMIT) return NextResponse.json(SAME_ANSWER);
  await admin.from("api_rate_limits").insert({ user_id: user.id, route: "forgot-password" });

  // Ссылка уходит только действующему участнику: у отключённого входа нет, и
  // выдавать ему новый пароль значит возвращать доступ мимо владельца.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("assignee_id, status")
    .eq("member_id", user.id)
    .maybeSingle();
  if (!membership || membership.status !== "active") return NextResponse.json(SAME_ANSWER);

  const { data: person } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, max_user_id")
    .eq("id", membership.assignee_id)
    .maybeSingle();
  const target = person ? chatsFor(person as ColleagueRow)[0] : null;
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
