import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { botUsername, inviteChannel, inviteLink, randomCode } from "@/lib/botInvite";

// An invite for one colleague: a short-lived code and the link that carries
// it. Neither messenger will let a bot write to someone who has never opened
// it, so this one-time step — they tap the link and press Start — is what
// makes everything else possible.
//
// The code is bound to the assignee row AND to the messenger it was issued
// for, so pressing Start attaches that chat to that person, and a code shown
// with the Telegram link cannot be used to connect a MAX chat.

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
  const channel = inviteChannel(body?.channel);
  if (!assigneeId) {
    return NextResponse.json({ error: "Не указан исполнитель" }, { status: 400 });
  }
  if (!botUsername(channel)) {
    return NextResponse.json(
      { error: channel === "max" ? "Бот в MAX ещё не подключён — нужен токен от MAX для партнёров" : "Бот в Telegram не настроен" },
      { status: 400 },
    );
  }

  // Read through the USER's client, not the admin one: RLS is what proves
  // this assignee belongs to whoever is asking.
  const { data: assignee, error: readError } = await supabase.from("assignees").select("id, name").eq("id", assigneeId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!assignee) return NextResponse.json({ error: "Исполнитель не найден" }, { status: 404 });

  const code = randomCode();
  const admin = createAdminClient();
  // Трое суток, а не пятнадцать минут.
  //
  // Пятнадцать минут — верный срок для собственной ссылки: её открывают в
  // соседней вкладке сразу. Для чужой это неверный срок совсем: ссылку
  // пересылают человеку, человек занят, открывает вечером — и получает
  // мёртвый код, а отправитель узнаёт об этом от него же, через день.
  // На четырнадцати руководителях такое случится не раз и не два.
  //
  // Цена — код живёт дольше: восемь символов из тридцати двух, и тот, кто
  // его перехватит, привяжет свой чат к чужому имени и станет получать его
  // задачи. Перехватывать надо именно ту переписку, в которой ссылку
  // прислали, а подключение видно в «Команде» и отключается там же.
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin
    .from("telegram_link_codes")
    .insert({ code, user_id: user.id, assignee_id: assignee.id, channel, expires_at: expiresAt });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    code,
    channel,
    name: assignee.name,
    botUsername: botUsername(channel),
    link: inviteLink(channel, code),
  });
}
