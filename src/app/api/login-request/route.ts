import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteLink } from "@/lib/botInvite";
import { isLoginToken, newLoginToken } from "@/lib/messengerLogin";

// Вход на компьютере через мессенджер (lib/messengerLogin), сторона окна.
//
// POST — завести запрос: токен и ссылки на ботов с ним. GET — «ну что?»:
// ждём / отказ / код входа. Код отдаётся ОДИН раз — строка тут же
// удаляется, — так что подсмотреть его вторым запросом нельзя.
//
// Публичный, потому что его зовёт страница входа, где сессии ещё нет.
// Сам по себе он ничего не открывает: код появляется только после нажатия
// «Да, войти» в чате, уже привязанном к человеку.

const MAX_ALIVE = 300;

export async function POST() {
  const admin = createAdminClient();
  // Уборка мимоходом: запросы живут десять минут, и отдельный крон ради
  // них не нужен.
  await admin.from("login_requests").delete().lt("expires_at", new Date().toISOString());
  // Маршрут публичный, и до 29.10.2026 у него не было предела вовсе: скрипт
  // заводил строки быстрее, чем их убирала уборка выше. Живых запросов при
  // пятнадцати людях — единицы; сотни разом значат не людей, а скрипт, и
  // отказ ему не мешает никому, кто входит по-настоящему.
  const { count: alive } = await admin.from("login_requests").select("token", { count: "exact", head: true });
  if ((alive ?? 0) >= MAX_ALIVE) {
    return NextResponse.json({ error: "Слишком много попыток входа — попробуйте через несколько минут" }, { status: 429 });
  }
  const token = newLoginToken();
  const { error } = await admin.from("login_requests").insert({ token });
  if (error) return NextResponse.json({ error: "Вход через мессенджер сейчас недоступен" }, { status: 500 });
  const [telegram, max] = await Promise.all([inviteLink("telegram", token), inviteLink("max", token)]);
  return NextResponse.json({ token, telegram: telegram || null, max: max || null });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!isLoginToken(token)) return NextResponse.json({ state: "expired" });
  const admin = createAdminClient();
  const { data } = await admin
    .from("login_requests")
    .select("expires_at, token_hash, refused_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ state: "expired" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (data.refused_at) return NextResponse.json({ state: "refused" }, { headers: { "Cache-Control": "no-store" } });
  if (!data.token_hash) return NextResponse.json({ state: "waiting" }, { headers: { "Cache-Control": "no-store" } });
  // Выдать и забыть: удаление с условием на token_hash — от двух
  // одновременных опросов достаётся одному.
  const { data: taken } = await admin.from("login_requests").delete().eq("token", token).not("token_hash", "is", null).select("token_hash");
  const tokenHash = (taken as { token_hash: string }[] | null)?.[0]?.token_hash;
  if (!tokenHash) return NextResponse.json({ state: "expired" }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ state: "approved", tokenHash }, { headers: { "Cache-Control": "no-store" } });
}
