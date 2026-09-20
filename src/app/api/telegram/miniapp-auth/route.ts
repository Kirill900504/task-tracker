import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { miniAppSession } from "@/lib/miniAppAuth";
import { TELEGRAM_CHANNEL } from "@/lib/botTransport";

// Вход в трекер из мини-приложения Telegram, без пароля.
//
// Здесь только то, что у Telegram своё: токен бота лежит в переменной
// окружения. Всё остальное — проверка подписи, поиск человека, выдача
// одноразового кода — общее с MAX и живёт в lib/miniAppAuth, потому что
// это правило «кому можно войти», а оно не может быть у мессенджеров
// разным.

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Бот Telegram не настроен" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { initData?: string } | null;
  const admin = createAdminClient();
  const result = await miniAppSession(admin, TELEGRAM_CHANNEL, token, String(body?.initData || ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Наружу уходит только одноразовый код и своя же почта — она нужна
  // странице, чтобы сказать «вы вошли как …», если что-то пойдёт не так.
  return NextResponse.json({ tokenHash: result.tokenHash, email: result.email });
}
