import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessLinkInput, readInput } from "@/lib/apiInput";
import { checkRateLimit } from "@/lib/rateLimit";
import { originOf, recoveryLink } from "@/lib/recoveryLink";

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

  const { data: body, error: badInput } = await readInput(req, accessLinkInput);
  if (badInput) return badInput;
  const assigneeId = body.assigneeId;

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

  // Сборка ссылки — общая с «Забыли пароль?» (recoveryLink.ts): там же
  // написано, почему она собирается на нашем домене, а не берётся у
  // Supabase готовой.
  const link = await recoveryLink(admin, email, originOf(req));
  if ("error" in link) {
    return NextResponse.json({ error: "Не получилось создать ссылку: " + link.error }, { status: 500 });
  }

  return NextResponse.json({
    link: link.link,
    email,
    name: assignee.name,
    disabled: membership.status === "disabled",
  });
}
