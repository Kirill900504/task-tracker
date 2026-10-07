import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calendarToken } from "@/lib/calendarFeed";

// Личная ссылка на календарь встреч — только тому, чей он. Ссылка сама по
// себе пароль к его расписанию (см. lib/calendarFeed), поэтому её выдаёт
// маршрут по сессии, а не страница из того, что знает браузер.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const secret = process.env.CALENDAR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) return NextResponse.json({ error: "Календарь не настроен" }, { status: 500 });
  const origin = new URL(req.url).origin;
  const path = `/api/calendar/${calendarToken(user.id, secret)}.ics`;
  return NextResponse.json({ https: origin + path, webcal: origin.replace(/^https?:/, "webcal:") + path });
}
