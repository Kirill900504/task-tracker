import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailProblem, inviteExpired, passwordProblem } from "@/lib/workspaceInvite";

// Redeeming an invitation — the only way an account comes into existence
// here. Open sign-up is not disabled by a setting somewhere that could be
// switched back on by accident: there is simply no other route that creates
// a user.
//
// Two ways in, because both happen:
//   * a new person, who sets himself a password here;
//   * someone already signed in (he had an account, or the owner is
//     accepting on a shared computer) — then the invitation is attached to
//     the session that is already there, and no password is involved.
//
// This route is reached WITHOUT a session, so it must be listed in
// src/lib/supabase/middleware.ts — otherwise it is redirected to /login and
// answers 405 with nothing in the logs to say why.

// What the page shows before anything is typed: whose invitation this is.
// Only the name, and only for a code that is currently valid — enough to
// reassure the right person that he is in the right place, and nothing of
// use to anyone else.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") || "";
  if (!code) return NextResponse.json({ error: "Ссылка неполная" }, { status: 400 });

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("assignee_id, email, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();
  if (!invite || invite.used_at || inviteExpired(invite.expires_at as string)) {
    return NextResponse.json({ error: "Приглашение недействительно или уже использовано" }, { status: 400 });
  }

  const { data: assignee } = await admin.from("assignees").select("name").eq("id", invite.assignee_id).maybeSingle();
  return NextResponse.json({ name: (assignee?.name as string) || "", email: (invite.email as string) || "" });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!code) return NextResponse.json({ error: "Ссылка неполная — в ней нет кода приглашения" }, { status: 400 });

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("code, owner_id, assignee_id, email, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();

  // One answer for every kind of bad code — expired, spent, never existed.
  // A visitor who guessed a code learns nothing from the difference.
  if (!invite || invite.used_at || inviteExpired(invite.expires_at as string)) {
    return NextResponse.json({ error: "Приглашение недействительно или уже использовано" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();

  let memberId = sessionUser?.id || "";
  let memberEmail = sessionUser?.email || "";

  if (!memberId) {
    const emailError = emailProblem(email);
    if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });
    const passwordError = passwordProblem(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    // Confirmed on creation: the invitation link IS the confirmation that
    // this address was reachable — it was sent to the person by the owner,
    // who knows who he is. A second confirmation email would only be one
    // more thing to get stuck in a corporate spam filter.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      const alreadyThere = (createError?.message || "").toLowerCase().includes("already");
      return NextResponse.json(
        {
          error: alreadyThere
            ? "На эту почту уже есть аккаунт — войдите в трекер и откройте ссылку приглашения ещё раз"
            : "Не получилось создать аккаунт: " + (createError?.message || "неизвестная ошибка"),
        },
        { status: alreadyThere ? 409 : 500 },
      );
    }
    memberId = created.user.id;
    memberEmail = created.user.email || email;
  }

  const { data: membership } = await admin
    .from("workspace_members")
    .select("id, member_id, status")
    .eq("owner_id", invite.owner_id)
    .eq("assignee_id", invite.assignee_id)
    .maybeSingle();

  const patch = { member_id: memberId, status: "active", joined_at: new Date().toISOString(), disabled_at: null };
  const { error: memberError } = membership
    ? await admin.from("workspace_members").update(patch).eq("id", membership.id)
    : await admin.from("workspace_members").insert({
        owner_id: invite.owner_id,
        assignee_id: invite.assignee_id,
        role: "manager",
        ...patch,
      });

  if (memberError) {
    // One login belongs to one workspace (see the unique index in migration
    // 0019). Hitting it means this person is already somebody else's
    // manager, which is a real situation and not a bug — so it gets a real
    // sentence rather than a constraint name.
    const conflict = (memberError.message || "").toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: conflict ? "Этот аккаунт уже привязан к другому трекеру" : memberError.message },
      { status: conflict ? 409 : 500 },
    );
  }

  await admin
    .from("workspace_invites")
    .update({ used_at: new Date().toISOString(), used_by: memberId })
    .eq("code", invite.code);

  // The password is never sent back; the browser signs in with what the
  // person typed, so the session is created the ordinary way.
  return NextResponse.json({ ok: true, email: memberEmail, alreadySignedIn: !!sessionUser });
}
