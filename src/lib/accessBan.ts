import type { SupabaseClient } from "@supabase/supabase-js";

// Запрет входа на сервере входа — вместе с отключением доступа (аудит
// 30.10.2026). Статус `disabled` в членстве закрывает данные (RLS) и новые
// кабинеты (lib/cabinet), но не учётную запись: её сессии продолжали
// обновляться, пароль продолжал подходить. Supabase умеет это сам — `ban`
// отказывает и во входе, и в обновлении сессии, — так что уже выданный
// токен доживает свой час и больше не продлевается.
//
// «Навсегда» — сто лет: у сервера входа нет слова «бессрочно», а снимает
// запрет «none».
const FOREVER = "876000h";

export async function setAccessBan(admin: SupabaseClient, authId: string, banned: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.auth.admin.updateUserById(authId, { ban_duration: banned ? FOREVER : "none" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
