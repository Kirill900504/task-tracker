import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { originOf } from "@/lib/recoveryLink";
import { withoutSelfMark } from "@/lib/actorName";
import { issueWelcomeCode, welcomeLink, welcomeMessage } from "@/lib/welcomeInvite";

// Выписать приглашения «всё в одном» (lib/welcomeInvite) — одному человеку
// или пачке сразу. Пачкой одним запросом, а не пятнадцатью: «Пригласить
// всех» раньше шло по одному запросу на человека и упиралось в предел
// маршрута ровно на середине списка.
//
// Приглашать — дело владельца (isOwner): строка человека должна быть в ЕГО
// пространстве. RLS здесь доказывает только «вижу», а видят список людей
// все руководители (0031) — проверка ниже не дублирует права, а сужает их.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { allowed } = await checkRateLimit(supabase, user.id, "workspace-welcome", 30, 600);
  if (!allowed) return NextResponse.json({ error: "Слишком много приглашений подряд, подождите немного" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.assigneeIds) ? (body.assigneeIds as unknown[]).filter((v): v is string => typeof v === "string") : [];
  if (!ids.length) return NextResponse.json({ error: "Не указано, кого приглашать" }, { status: 400 });
  if (ids.length > 100) return NextResponse.json({ error: "Слишком длинный список" }, { status: 400 });

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("assignees")
    .select("id, name, user_id, archived_at")
    .in("id", ids)
    .eq("user_id", user.id)
    .is("archived_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const people = (rows || []) as { id: string; name: string }[];
  if (!people.length) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });

  const origin = originOf(req);
  const invites = await Promise.all(
    people.map(async (p) => {
      const name = withoutSelfMark(p.name);
      const made = await issueWelcomeCode(admin, user.id, p.id);
      if ("error" in made) return { id: p.id, name, error: made.error };
      const link = welcomeLink(origin, made.code);
      return { id: p.id, name, link, message: welcomeMessage(name, link) };
    }),
  );
  // Порядок — тот, в котором просили: это порядок «Команды».
  const order = new Map(ids.map((id, i) => [id, i]));
  invites.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return NextResponse.json({ invites });
}
