import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { emailProblem, passwordProblem } from "@/lib/workspaceInvite";
import { isServiceEmail } from "@/lib/cabinet";
import { normalizePhone } from "@/lib/phone";

// «Мои данные» в личном кабинете: рабочая почта, телефон и пароль.
//
// Кабинет, заведённый мессенджером (lib/cabinet), живёт на служебном
// адресе, и войти в него можно только из мессенджера или через бота на
// странице входа. Почту и пароль человек задаёт здесь сам, а не через
// владельца: пароль, который знают двое, делает «это писал не я»
// неразрешимым.
//
// 28.10.2026 сюда добавлен телефон, и всё стало ВТОРЫМ шагом, а не частью
// подключения (его слова: «если не при регистрации, так потом, вторым
// этапом»): подключение остаётся одним нажатием «Start», а данные человек
// вносит, когда уже внутри. Поэтому поля сохраняются по отдельности —
// можно указать один телефон, а почту позже, — и GET отвечает, заполнено
// ли всё (`complete`): по нему трекер один раз сам открывает кабинет.
//
// Почта не подтверждается письмом по той же причине, что и в приглашении
// (/api/workspace/join): письма Supabase до людей не доходят, а вход с
// этой почтой и есть подтверждение, что человек её знает.

// Своя строка в списке людей: у руководителя — по строке членства, у
// владельца — строка «(я)» в его же пространстве (lib/reach).
async function ownRow(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: member } = await admin
    .from("workspace_members")
    .select("assignee_id")
    .eq("member_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (member?.assignee_id) return member.assignee_id as string;
  const { data: self } = await admin
    .from("assignees")
    .select("id")
    .eq("user_id", userId)
    .like("name", "%(я)")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (self?.id as string) || null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const admin = createAdminClient();
  const rowId = await ownRow(admin, user.id);
  const { data: row } = rowId ? await admin.from("assignees").select("phone").eq("id", rowId).maybeSingle() : { data: null };
  const email = isServiceEmail(user.email) ? "" : user.email || "";
  const phone = (row?.phone as string) || "";
  // Пароль есть у всякого, кто входил не из мессенджера: у служебной почты
  // его нет, у настоящей — задан при приглашении или здесь.
  const hasPassword = !!email;
  return NextResponse.json({ email, phone, hasPassword, complete: !!email && !!phone });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const admin = createAdminClient();
  const { allowed } = await checkRateLimit(admin, user.id, "account-credentials", 10, 600);
  if (!allowed) return NextResponse.json({ error: "Слишком много попыток подряд, подождите немного" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown; phone?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone : null;

  const phone = rawPhone === null ? null : normalizePhone(rawPhone);
  if (rawPhone !== null && phone === null) {
    return NextResponse.json({ error: "Не похоже на номер телефона — например, +7 900 123-45-67" }, { status: 400 });
  }

  const currentEmail = isServiceEmail(user.email) ? "" : (user.email || "").toLowerCase();
  const emailChanged = !!email && email !== currentEmail;
  if (emailChanged) {
    const problem = emailProblem(email);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (isServiceEmail(email)) return NextResponse.json({ error: "Укажите свою рабочую почту" }, { status: 400 });
  }
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }
  // Пароль без почты — вход, которым нечем воспользоваться: на странице
  // входа спросят почту. И наоборот: почта у кабинета из мессенджера без
  // пароля — тоже вход в никуда.
  const finalEmail = emailChanged ? email : currentEmail;
  if (password && !finalEmail) return NextResponse.json({ error: "Сначала укажите рабочую почту — с ней и паролем входят с компьютера" }, { status: 400 });
  if (emailChanged && !password && !currentEmail) {
    return NextResponse.json({ error: "Придумайте пароль — без него с компьютера не войти" }, { status: 400 });
  }

  if (emailChanged || password) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      ...(emailChanged ? { email, email_confirm: true } : {}),
      ...(password ? { password } : {}),
    });
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return NextResponse.json(
        { error: taken ? "Эта почта уже занята другим входом в трекер" : "Не получилось сохранить: " + error.message },
        { status: taken ? 409 : 500 },
      );
    }
  }

  if (phone !== null) {
    const rowId = await ownRow(admin, user.id);
    if (!rowId) return NextResponse.json({ error: "Не нашёл вас в списке людей трекера" }, { status: 404 });
    const { error } = await admin.from("assignees").update({ phone: phone || null }).eq("id", rowId);
    if (error) return NextResponse.json({ error: "Не получилось сохранить телефон: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email: finalEmail, phone: phone ?? undefined });
}
