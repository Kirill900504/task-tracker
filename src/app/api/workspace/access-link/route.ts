import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";

// Возвращение доступа человеку, который УЖЕ вошёл когда-то.
//
// Приглашение (/api/workspace/invite) заводит учётную запись и работает
// ровно один раз: после «уже в трекере» оно отвечает отказом, и правильно
// делает — второй такой ссылкой человек завёл бы себе второй аккаунт, а
// старый остался бы с его комментариями и отчётами.
//
// Но ссылку теряют, пароль забывают, а почта у половины людей корпоративная
// и до письма о сбросе пароля они доберутся не сегодня. Раньше выхода из
// этого положения в трекере не было вовсе: владелец видел строку «в
// трекере» и ни одной кнопки рядом. Отсюда этот маршрут — он выдаёт
// владельцу ссылку на смену пароля ДЛЯ ТОГО ЖЕ аккаунта, которую можно
// переслать человеку в мессенджере, и заодно почту, под которой этот
// человек в трекере записан: без неё войти нельзя, а нигде в интерфейсе она
// не показана.
//
// Почему это не «владелец задаёт пароль сам»: тогда пароль знали бы двое,
// и любой отчёт «это писал не я» стал бы неразрешимым. Ссылка одноразовая,
// пароль придумывает человек, а владелец остаётся тем, кто её передал.

function originOf(req: Request): string {
  // За прокси Vercel в request.url лежит внутренний адрес — человеку уедет
  // тот, что в заголовках.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { allowed } = await checkRateLimit(supabase, user.id, "workspace-access-link", 20, 600);
  if (!allowed) {
    return NextResponse.json({ error: "Слишком много ссылок подряд, подождите немного" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const assigneeId = typeof body?.assigneeId === "string" ? body.assigneeId : "";
  if (!assigneeId) return NextResponse.json({ error: "Не указан человек" }, { status: 400 });

  // Через клиент ПОЛЬЗОВАТЕЛЯ: принадлежность человека доказывает RLS, а не
  // проверка, которую здесь можно однажды забыть дописать.
  const { data: assignee, error: readError } = await supabase
    .from("assignees")
    .select("id, name")
    .eq("id", assigneeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!assignee) return NextResponse.json({ error: "Человек не найден" }, { status: 404 });

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("member_id, status")
    .eq("owner_id", user.id)
    .eq("assignee_id", assignee.id)
    .maybeSingle();

  // Ещё не входил ни разу — тогда нужна не эта ссылка, а обычное
  // приглашение, и сказать об этом полезнее, чем отказать одним словом.
  if (!membership?.member_id) {
    return NextResponse.json(
      { error: `${assignee.name} ещё не заходил в трекер — нажмите «+ В трекер», это другая ссылка` },
      { status: 409 },
    );
  }
  if (membership.member_id === user.id) {
    return NextResponse.json({ error: "Это ваш собственный вход — меняйте пароль на странице входа" }, { status: 400 });
  }

  const { data: member, error: memberError } = await admin.auth.admin.getUserById(membership.member_id as string);
  if (memberError || !member?.user?.email) {
    return NextResponse.json({ error: "Не нашёл почту этого входа — напишите, разберусь" }, { status: 500 });
  }
  const email = member.user.email;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (linkError || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: "Не получилось создать ссылку: " + (linkError?.message || "") }, { status: 500 });
  }

  // Ссылка собирается НА НАШ домен, а не берётся готовой (`action_link`).
  //
  // Готовая ведёт на `<проект>.supabase.co/auth/v1/verify?...&redirect_to=`,
  // и redirect_to в ней Supabase молча заменяет своим Site URL, если наш
  // адрес не внесён в его список разрешённых. В этом проекте он не внесён:
  // проверка 19.09.2026 вернула `redirect_to=http://localhost:3000` — то
  // есть человек, открывший такую ссылку, уехал бы на пустой localhost.
  //
  // Поэтому наружу отдаётся адрес трекера с одноразовым `token_hash`, а
  // /reset-password меняет его на сессию сам (verifyOtp). Ничего в чужой
  // панели настраивать для этого не нужно — и человек видит знакомый адрес
  // трекера, а не незнакомый supabase.co.
  return NextResponse.json({
    link: `${originOf(req)}/reset-password?token_hash=${encodeURIComponent(link.properties.hashed_token)}`,
    email,
    name: assignee.name,
    disabled: membership.status === "disabled",
  });
}
