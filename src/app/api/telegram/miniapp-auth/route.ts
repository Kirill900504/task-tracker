import { NextResponse } from "next/server";
import { miniAppSignIn } from "@/lib/miniAppRoute";
import { TELEGRAM_CHANNEL } from "@/lib/botTransport";

// Вход в трекер из мини-приложения Telegram, без пароля.
//
// Здесь только то, что у Telegram своё: токен бота лежит в переменной
// окружения. Всё остальное — проверка подписи, поиск человека, кабинет,
// сессия — общее с MAX и живёт в lib/miniAppAuth и lib/miniAppRoute,
// потому что это правило «кому можно войти», а оно не может быть у
// мессенджеров разным.

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Бот Telegram не настроен" }, { status: 503 });
  return miniAppSignIn(req, TELEGRAM_CHANNEL, token);
}
