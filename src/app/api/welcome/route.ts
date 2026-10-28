import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteLink } from "@/lib/botInvite";
import { withoutSelfMark } from "@/lib/actorName";
import { desktopInstallerUrl, WELCOME_CHANNEL } from "@/lib/welcomeInvite";

// Что показать на странице приглашения /welcome/<код> (lib/welcomeInvite).
//
// Публичный: его открывает человек, у которого ещё нет ни входа, ни
// сессии. Поэтому отдаёт он ровно то, что и так написано в самой ссылке для
// этого человека: его имя, имя пригласившего, ссылки на ботов с тем же
// кодом и подключён ли он уже. Ни задач, ни людей, ни почты. Перебирать
// коды бессмысленно: восемь символов из тридцати двух — триллион вариантов
// на неделю жизни кода.
//
// Страница спрашивает его повторно, пока открыта: человек нажал «Start» в
// Telegram, вернулся во вкладку — и шаг уже отмечен «✓», без перезагрузки.

export async function GET(req: Request) {
  const code = (new URL(req.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return NextResponse.json({ error: "Неверная ссылка приглашения" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("telegram_link_codes")
    .select("user_id, assignee_id, channel, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!row || row.channel !== WELCOME_CHANNEL || !row.assignee_id) {
    return NextResponse.json({ error: "Приглашение не найдено — попросите прислать новую ссылку." }, { status: 404 });
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: "Срок приглашения истёк — попросите прислать новую ссылку." }, { status: 410 });
  }

  const [{ data: person }, { data: inviter }, telegramLink, maxLink, desktop] = await Promise.all([
    admin
      .from("assignees")
      .select("name, telegram_chat_id, max_user_id, archived_at")
      .eq("id", row.assignee_id as string)
      .maybeSingle(),
    admin
      .from("assignees")
      .select("name")
      .eq("user_id", row.user_id as string)
      .like("name", "%(я)")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    inviteLink("telegram", code),
    inviteLink("max", code),
    desktopInstallerUrl(),
  ]);
  if (!person || person.archived_at) {
    return NextResponse.json({ error: "Приглашение больше не действует." }, { status: 410 });
  }

  return NextResponse.json(
    {
      name: withoutSelfMark(person.name as string),
      inviter: withoutSelfMark((inviter?.name as string) || ""),
      telegram: telegramLink ? { link: telegramLink, connected: !!person.telegram_chat_id } : null,
      max: maxLink ? { link: maxLink, connected: !!person.max_user_id } : null,
      desktop,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
