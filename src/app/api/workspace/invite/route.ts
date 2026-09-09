import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { joinLink, randomInviteCode } from "@/lib/workspaceInvite";

// The owner inviting one of his people INTO THE TRACKER — not into a
// messenger. The messenger invite (/api/telegram/invite) attaches a chat to
// a name; this one gives that same name a login.
//
// The two are deliberately separate and a person may have either, both, or
// neither: a manager who only ever answers from Telegram never needs this,
// and one who lives at his computer never needs the other.

function originOf(req: Request): string {
  // Behind Vercel's proxy the request URL is the internal one, so the
  // forwarded headers are what the person will actually see in his browser.
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

  const { allowed } = await checkRateLimit(supabase, user.id, "workspace-invite", 20, 600);
  if (!allowed) {
    return NextResponse.json({ error: "Слишком много приглашений подряд, подождите немного" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const assigneeId = typeof body?.assigneeId === "string" ? body.assigneeId : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const direction = typeof body?.direction === "string" ? body.direction.trim() : "";
  if (!assigneeId) return NextResponse.json({ error: "Не указан человек" }, { status: 400 });

  // Read through the USER's client: RLS is what proves this person belongs
  // to whoever is asking, rather than a check that could be forgotten here.
  const { data: assignee, error: readError } = await supabase
    .from("assignees")
    .select("id, name")
    .eq("id", assigneeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!assignee) return NextResponse.json({ error: "Человек не найден" }, { status: 404 });

  const admin = createAdminClient();

  // Already in? Then there is nothing to invite him to, and saying so is
  // more useful than issuing a link that will refuse to work.
  const { data: existing } = await admin
    .from("workspace_members")
    .select("id, status, member_id")
    .eq("owner_id", user.id)
    .eq("assignee_id", assignee.id)
    .maybeSingle();
  if (existing?.status === "active") {
    return NextResponse.json({ error: `${assignee.name} уже в трекере` }, { status: 409 });
  }

  // The membership row exists from the moment of the invitation, in the
  // 'invited' state: the owner can then see who was invited and has not yet
  // come in, which is exactly the kind of thing that otherwise gets lost.
  if (!existing) {
    const { error: memberError } = await admin.from("workspace_members").insert({
      owner_id: user.id,
      assignee_id: assignee.id,
      role: "manager",
      status: "invited",
      direction,
    });
    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });
  } else if (direction) {
    await admin.from("workspace_members").update({ direction }).eq("id", existing.id);
  }

  // A previous unused invitation for the same person is dropped: two live
  // links to one account is one more than anybody needs.
  await admin.from("workspace_invites").delete().eq("owner_id", user.id).eq("assignee_id", assignee.id).is("used_at", null);

  const code = randomInviteCode();
  const { error } = await admin.from("workspace_invites").insert({
    code,
    owner_id: user.id,
    assignee_id: assignee.id,
    email: email || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ code, name: assignee.name, link: joinLink(originOf(req), code) });
}
