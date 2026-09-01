import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function POST() {
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

  const code = randomCode();
  const admin = createAdminClient();
  const { error } = await admin.from("telegram_link_codes").insert({ code, user_id: user.id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ code, botUsername: process.env.TELEGRAM_BOT_USERNAME || "" });
}
