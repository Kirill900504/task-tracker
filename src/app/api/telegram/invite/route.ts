import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";

// An invite for one colleague: a short-lived code and the link that carries
// it. Telegram will not let a bot write to someone who has never opened it,
// so this one-time step — they tap the link and press Start — is what makes
// everything else possible.
//
// The code is bound to the assignee row, so pressing Start attaches that
// chat to that person and to nothing else.

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(supabase, user.id, "telegram-invite", 20, 600);
  if (!allowed) {
    return NextResponse.json({ error: "Слишком много приглашений подряд, подождите немного" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const assigneeId = typeof body?.assigneeId === "string" ? body.assigneeId : "";
  if (!assigneeId) {
    return NextResponse.json({ error: "Не указан исполнитель" }, { status: 400 });
  }

  // Read through the USER's client, not the admin one: RLS is what proves
  // this assignee belongs to whoever is asking.
  const { data: assignee, error: readError } = await supabase.from("assignees").select("id, name").eq("id", assigneeId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!assignee) return NextResponse.json({ error: "Исполнитель не найден" }, { status: 404 });

  const code = randomCode();
  const admin = createAdminClient();
  const { error } = await admin.from("telegram_link_codes").insert({ code, user_id: user.id, assignee_id: assignee.id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || "";
  return NextResponse.json({
    code,
    name: assignee.name,
    botUsername,
    link: botUsername ? `https://t.me/${botUsername}?start=${code}` : "",
  });
}
