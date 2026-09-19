// Проверка механики: обменивается ли hashed_token на сессию тем же самым
// способом, каким это делает страница /reset-password (anon-клиент,
// verifyOtp). Ничего секретного не печатает — только «получилось/нет».
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: "kucherenko@rokass.ru" });
if (error) throw error;

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: session, error: vErr } = await anon.auth.verifyOtp({
  type: "recovery",
  token_hash: data.properties.hashed_token,
});
console.log("обмен токена:", vErr ? "ОШИБКА — " + vErr.message : "получилось");
console.log("сессия для:", session?.user?.email || "нет");
