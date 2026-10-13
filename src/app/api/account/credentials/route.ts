import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { emailProblem, passwordProblem } from "@/lib/workspaceInvite";
import { isServiceEmail } from "@/lib/cabinet";

// Почта и пароль для входа с компьютера — из личного кабинета.
//
// Кабинет, заведённый мессенджером (lib/cabinet), живёт на служебном
// адресе, и войти в него можно только из мессенджера или по ссылке «вход».
// Чтобы открыть трекер на рабочем компьютере обычным способом, человек
// задаёт здесь свою почту и пароль — сам, а не через владельца: пароль,
// который знают двое, делает «это писал не я» неразрешимым.
//
// Почта не подтверждается письмом по той же причине, что и в приглашении
// (/api/workspace/join): письма Supabase до людей не доходят, а вход с
// этой почтой и есть подтверждение, что человек её знает.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const email = user.email || "";
  return NextResponse.json({ email: isServiceEmail(email) ? "" : email });
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

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const problem = emailProblem(email) || (password ? passwordProblem(password) : "");
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (isServiceEmail(email)) return NextResponse.json({ error: "Укажите свою рабочую почту" }, { status: 400 });
  // Без пароля почту сменить можно, но войти с ней будет нечем — тому, у
  // кого пароля ещё нет (кабинет из мессенджера), пароль обязателен.
  if (!password && isServiceEmail(user.email)) {
    return NextResponse.json({ error: "Придумайте пароль — без него с компьютера не войти" }, { status: 400 });
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true,
    ...(password ? { password } : {}),
  });
  if (error) {
    const taken = /already|registered|exists/i.test(error.message);
    return NextResponse.json(
      { error: taken ? "Эта почта уже занята другим входом в трекер" : "Не получилось сохранить: " + error.message },
      { status: taken ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true, email });
}
