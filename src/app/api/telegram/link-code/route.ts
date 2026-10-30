import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { botUsername, inviteChannel, inviteLink, randomCode } from "@/lib/botInvite";

// The owner connecting his OWN chat — same handshake as a colleague's
// invite, without an assignee attached, and for whichever messenger was
// asked for.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(supabase, user.id, "telegram-link-code", 5, 600);
  if (!allowed) {
    return NextResponse.json({ error: "Слишком много попыток, подождите немного" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const channel = inviteChannel(body?.channel);
  const username = await botUsername(channel);
  if (!username) {
    return NextResponse.json(
      { error: channel === "max" ? "Бот в MAX ещё не подключён — откройте /max и вставьте токен" : "Бот в Telegram не настроен" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  // Код без человека привязывает чат к УЧЁТНОЙ ЗАПИСИ — так подключается
  // только владелец пространства (второй аудит 30.10.2026). Маршрут
  // выдавал такой код любому вошедшему: чат участника ложился в таблицу
  // аккаунтов, и бот дальше разбирал его как владельца пустого
  // пространства — с чужим меню, чужой сводкой и еженедельной «резервной
  // копией». Участник подключает свой чат к своей строке
  // (/api/telegram/invite из «Личного кабинета»).
  const { data: membership } = await admin.from("workspace_members").select("id").eq("member_id", user.id).limit(1).maybeSingle();
  if (membership) {
    return NextResponse.json({ error: "Мессенджер подключается в «Личном кабинете» — своё имя вверху трекера" }, { status: 403 });
  }

  const code = randomCode();
  const { error } = await admin.from("telegram_link_codes").insert({ code, user_id: user.id, channel });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ code, channel, botUsername: username, link: await inviteLink(channel, code) });
}
