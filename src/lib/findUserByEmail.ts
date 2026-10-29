import type { SupabaseClient, User } from "@supabase/supabase-js";

// Учётная запись по почте — одним узким запросом, а не перебором всех.
//
// «Забыли пароль?» искал вход, выкачивая из Supabase ВСЕ учётные записи
// разом (`listUsers`, страница в тысячу) и перебирая их в памяти — на
// каждое нажатие публичной кнопки, то есть столько раз, сколько её нажмёт
// кто угодно. И молча переставал находить людей, как только их станет
// больше тысячи (аудит 29.10.2026). У SDK поиска по почте нет, но у самого
// сервера входа он есть — параметр `filter` (поиск по подстроке): им и
// спрашиваем, а совпадение «буква в букву» проверяем сами. Если сервер
// фильтр не понял — прежний перебор как запасной путь, чтобы кнопка не
// сломалась от обновления чужой стороны.
export async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (base && key) {
    try {
      const res = await fetch(`${base}/auth/v1/admin/users?per_page=50&filter=${encodeURIComponent(wanted)}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { users?: User[] };
        if (Array.isArray(body.users)) return body.users.find((u) => (u.email || "").toLowerCase() === wanted) ?? null;
      }
    } catch {
      /* запасной путь ниже */
    }
  }
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (data?.users || []).find((u) => (u.email || "").toLowerCase() === wanted) ?? null;
}
