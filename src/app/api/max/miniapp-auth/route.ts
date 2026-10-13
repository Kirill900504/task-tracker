import { NextResponse } from "next/server";
import { miniAppSignIn } from "@/lib/miniAppRoute";
import { MAX_CHANNEL } from "@/lib/botTransport";
import { maxSettings } from "@/lib/botSettings";

// Вход в трекер из мини-приложения MAX, без пароля.
//
// Отличие от Telegram ровно одно: токен бота у MAX лежит не в переменной
// окружения, а в таблице — его вводят на странице /max, потому что
// отправлять Кирилла в панель Vercel за переменной значило бы четыре
// экрана чужих настроек (CLAUDE.md). Проверка подписи и правило «кому
// можно войти» — общие, в lib/miniAppAuth.
//
// Подпись MAX считает тем же алгоритмом, что Telegram, вплоть до строки
// «WebAppData» (dev.max.ru, «Валидация данных»), поэтому отдельной
// проверки здесь нет и заводить её не надо.

export async function POST(req: Request) {
  const settings = await maxSettings();
  if (!settings?.token) {
    return NextResponse.json({ error: "Бот MAX не подключён — откройте /max в трекере" }, { status: 503 });
  }
  return miniAppSignIn(req, MAX_CHANNEL, settings.token);
}
