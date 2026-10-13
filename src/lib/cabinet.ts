import type { SupabaseClient } from "@supabase/supabase-js";

// Личный кабинет — вход в трекер у человека из «Команды».
//
// До 13.10.2026 кабинет появлялся только через приглашение: Кирилл жмёт
// «Пригласить», пересылает ссылку, человек открывает её, придумывает
// почту и пароль. Каждый шаг этой цепочки терялся: из пятнадцати человек
// вход был у семи, ещё один полторы недели висел «приглашённым», а
// мессенджер подключали отдельной, второй ссылкой. Его слова: «улучши
// систему подключения новых пользователей и внедри полноценную работу
// личных кабинетов».
//
// Теперь доказательство личности одно, и оно уже есть: чат мессенджера,
// привязанный к строке человека. Привязать его можно только кодом,
// который выписал владелец (из «Команды») или сам человек из своего
// кабинета, — то есть привязка и ЕСТЬ приглашение, выданное Кириллом.
// Поэтому кабинет заводится сам, в ту секунду, когда человек из этого чата
// открывает трекер (мини-приложение) или просит ссылку входа («вход»).
// Почты и пароля для этого не нужно: учётной записи даётся служебный
// адрес на `.invalid`, на который ничего никогда не уйдёт, а свою почту и
// пароль — для входа с компьютера — человек задаёт в кабинете сам, если
// захочет.
//
// Граница, которая не двигается: отключённому доступу (`disabled`) кабинет
// не возвращается ни этим путём, ни каким-либо другим. Кирилл отключил —
// значит, отключил; иначе кнопка «Отключить» работала бы до первого
// открытия мини-приложения.

export const SERVICE_EMAIL_DOMAIN = "rokas.invalid";

// Служебный адрес по строке человека — детерминированный нарочно: два
// одновременных открытия мини-приложения создадут одного пользователя, а
// второе получит «уже есть» и найдёт первого через членство.
export function serviceEmail(assigneeId: string): string {
  return `kabinet-${assigneeId}@${SERVICE_EMAIL_DOMAIN}`;
}

// Настоящая ли это почта — или служебная, которую не показывают как «вашу».
export function isServiceEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith("@" + SERVICE_EMAIL_DOMAIN);
}

type Member = { id: string; member_id: string | null; status: string };

// Что делать с найденным членством. Отдельно от базы, чтобы правило
// проверялось без неё (cabinet.test.ts).
export function cabinetDecision(
  member: Member | null,
): { kind: "ready"; authId: string } | { kind: "refused" } | { kind: "create"; memberRowId: string | null } {
  if (member?.status === "disabled") return { kind: "refused" };
  if (member?.status === "active" && member.member_id) return { kind: "ready", authId: member.member_id };
  return { kind: "create", memberRowId: member?.id ?? null };
}

export type CabinetResult = { ok: true; authId: string; created: boolean } | { ok: false; error: string };

export const REFUSED_TEXT = "Доступ к трекеру вам отключён. Если это ошибка — напишите Кириллу.";

export async function ensureCabinet(admin: SupabaseClient, assigneeId: string): Promise<CabinetResult> {
  const { data: person } = await admin.from("assignees").select("id, name, user_id").eq("id", assigneeId).maybeSingle();
  const row = person as { id: string; name: string; user_id: string } | null;
  if (!row) return { ok: false, error: "Не нашёл вас в списке людей трекера." };

  // Строка «(я)» — сам владелец: его вход и есть пространство.
  if (/\(я\)\s*$/.test(row.name)) return { ok: true, authId: row.user_id, created: false };

  const readMember = async () => {
    const { data } = await admin
      .from("workspace_members")
      .select("id, member_id, status")
      .eq("owner_id", row.user_id)
      .eq("assignee_id", row.id)
      .maybeSingle();
    return (data as Member | null) ?? null;
  };

  const decision = cabinetDecision(await readMember());
  if (decision.kind === "refused") return { ok: false, error: REFUSED_TEXT };
  if (decision.kind === "ready") return { ok: true, authId: decision.authId, created: false };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: serviceEmail(row.id),
    email_confirm: true,
    user_metadata: { name: row.name },
  });
  if (createError || !created?.user) {
    // Второе одновременное открытие: первое уже завело и привязало.
    const again = cabinetDecision(await readMember());
    if (again.kind === "ready") return { ok: true, authId: again.authId, created: false };
    return { ok: false, error: "Не получилось завести кабинет: " + (createError?.message || "неизвестная ошибка") };
  }

  const authId = created.user.id;
  const patch = { member_id: authId, status: "active", joined_at: new Date().toISOString(), disabled_at: null };
  const { error: memberError } = decision.memberRowId
    ? await admin.from("workspace_members").update(patch).eq("id", decision.memberRowId)
    : await admin.from("workspace_members").insert({ owner_id: row.user_id, assignee_id: row.id, role: "manager", ...patch });
  if (memberError) {
    // Учётная запись без членства — вход в пустоту; убираем, чтобы
    // следующая попытка начала с чистого места.
    await admin.auth.admin.deleteUser(authId);
    return { ok: false, error: "Не получилось завести кабинет: " + memberError.message };
  }
  return { ok: true, authId, created: true };
}
