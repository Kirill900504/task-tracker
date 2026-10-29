import { NextResponse, after } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { emailProblem, passwordProblem } from "@/lib/workspaceInvite";
import { isServiceEmail } from "@/lib/cabinet";
import { normalizePhone } from "@/lib/phone";
import { signedInWithPassword, type Amr } from "@/lib/signInMethod";
import { accountChat } from "@/lib/accountChat";
import { sendToColleague } from "@/lib/botDelivery";

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
  // Спросит ли сохранение текущий пароль — окно показывает поле заранее,
  // а не после отказа (см. needsCurrentPassword ниже).
  const needsCurrent = hasPassword && signedInWithPassword(await amrOf(supabase));
  return NextResponse.json({ email, phone, hasPassword, needsCurrent, complete: !!email && !!phone });
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Чем доказан этот вход (lib/signInMethod) — из ПРОВЕРЕННОГО токена:
// getClaims сверяет подпись, а не верит тому, что лежит в куке.
async function amrOf(supabase: ServerClient): Promise<Amr> {
  const { data } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  return (data?.claims as { amr?: Amr } | undefined)?.amr ?? null;
}

// Подходит ли пароль — отдельным клиентом без памяти, чтобы проверка не
// подменила сессию самого человека. Сессию, которую проверка всё-таки
// заводит на сервере входа, тут же закрываем: лишний живой вход — это
// ровно то, от чего вся проверка защищает.
async function currentPasswordFits(admin: SupabaseClient, email: string, password: string): Promise<boolean> {
  const probe = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await admin.auth.admin.signOut(data.session.access_token, "local").catch(() => undefined);
  return true;
}

// «Пароль изменён» — туда же, куда приходит ссылка на новый пароль
// (lib/accountChat). Если менял не сам человек, это первое и часто
// единственное, по чему он об этом узнает: войти с прежним паролем он
// уже не сможет и решит, что опечатался.
function changeNotice(what: { password: boolean; email: string | null }): string {
  const when = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());
  const lines = [
    what.password && what.email
      ? `🔐 Изменены пароль и почта для входа в трекер — теперь ${what.email}`
      : what.password
        ? "🔐 Пароль для входа в трекер изменён"
        : `🔐 Почта для входа в трекер изменена — теперь ${what.email}`,
    `${when} (МСК). На остальных устройствах вход нужно повторить.`,
    "Если это были не вы — войдите через этого бота (кнопка «💻 Вход с компьютера») и задайте новый пароль в «Личном кабинете».",
  ];
  return lines.join("\n\n");
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

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown; phone?: unknown; currentPassword?: unknown; recovery?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
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
  const amr = emailChanged || password ? await amrOf(supabase) : null;
  // Исключение — страница «Новый пароль» (/reset-password): туда приходят
  // по ссылке восстановления, и у служебного кабинета, которому владелец
  // выдал такую ссылку, своей почты нет — пароль ставится к той, под которой
  // он записан (владелец её показал вместе со ссылкой). Страница говорит о
  // себе полем `recovery` (по токену её не отличить от входа через бота —
  // lib/signInMethod); подделывать его незачем: оно разрешает только пароль
  // к ТОЙ ЖЕ почте, под которой этот вход уже записан.
  const recovering = body?.recovery === true && !emailChanged;
  if (password && !finalEmail && !recovering) {
    return NextResponse.json({ error: "Сначала укажите рабочую почту — с ней и паролем входят с компьютера" }, { status: 400 });
  }
  if (emailChanged && !password && !currentEmail) {
    return NextResponse.json({ error: "Придумайте пароль — без него с компьютера не войти" }, { status: 400 });
  }

  // Текущий пароль — когда вход получен паролем и меняется сам вход
  // (lib/signInMethod). Иначе открытый на минуту чужой ноутбук позволял
  // сменить и пароль, и почту — и вход уходил навсегда, а прежний хозяин не
  // мог даже восстановить его: «Забыли пароль?» искал бы уже чужую почту.
  // Неверные попытки считает тот же предел частоты выше — перебором пароль
  // отсюда не подобрать.
  if ((emailChanged || password) && currentEmail && signedInWithPassword(amr)) {
    if (!currentPassword) return NextResponse.json({ error: "Введите текущий пароль", needsCurrent: true }, { status: 400 });
    if (!(await currentPasswordFits(admin, currentEmail, currentPassword))) {
      return NextResponse.json({ error: "Текущий пароль не подходит", needsCurrent: true }, { status: 403 });
    }
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
    // Новый пароль закрывает ВСЕ прочие входы (стандарт, и смысл смены
    // пароля чаще всего именно в этом: «кто-то знает мой пароль»). Этот вход
    // остаётся — человек сидит в нём прямо сейчас. Вход из мессенджера
    // (мини-приложение) потом поднимется сам, по подписи мессенджера.
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (token) await admin.auth.admin.signOut(token, "others").catch(() => undefined);
    // Весть — после ответа: сохранение не ждёт полёта до мессенджера.
    const notice = changeNotice({ password: !!password, email: emailChanged ? email : null });
    const userId = user.id;
    after(async () => {
      const chat = await accountChat(admin, userId).catch(() => null);
      if (chat) await sendToColleague(chat, notice).catch(() => undefined);
    });
  }

  if (phone !== null) {
    const rowId = await ownRow(admin, user.id);
    if (!rowId) return NextResponse.json({ error: "Не нашёл вас в списке людей трекера" }, { status: 404 });
    const { error } = await admin.from("assignees").update({ phone: phone || null }).eq("id", rowId);
    if (error) return NextResponse.json({ error: "Не получилось сохранить телефон: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email: finalEmail, phone: phone ?? undefined });
}
