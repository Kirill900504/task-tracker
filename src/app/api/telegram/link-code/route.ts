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
  if (!botUsername(channel)) {
    return NextResponse.json(
      { error: channel === "max" ? "Бот в MAX ещё не подключён — нужен токен от MAX для партнёров" : "Бот в Telegram не настроен" },
      { status: 400 },
    );
  }

  const code = randomCode();
  const admin = createAdminClient();
  const { error } = await admin.from("telegram_link_codes").insert({ code, user_id: user.id, channel });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ code, channel, botUsername: botUsername(channel), link: inviteLink(channel, code) });
}
