import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyOwner } from "@/lib/botDelivery";
import { crashNotice, fingerprintOf, shouldNotify, tooMany, WRITE_WINDOW_MS } from "@/lib/crashReport";

// Куда браузер сообщает, что упал.
//
// Вставка идёт служебным ключом, а не из браузера, и это не перестраховка:
// у таблицы нет политик на запись вовсе (миграция 0035). Причина в том, как
// падает интерфейс — не одной ошибкой, а циклом: 19.09.2026 отрисовка
// перезапускала сама себя, пока браузер не сдавался. Такой цикл из браузера
// залил бы таблицу за минуту, и настоящая поломка утонула бы в копиях
// самой себя.
//
// Маршрут стоит в исключениях middleware: упасть можно и до входа, на
// странице логина, и редирект на /login вместо приёма сообщения об ошибке
// означал бы, что именно об этих поломках мы не узнаем никогда.

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { message?: string; stack?: string; url?: string; release?: string }
    | null;
  const message = (body?.message || "").trim();
  // Пустое сообщение — это не поломка, а мусор от расширения браузера.
  if (!message) return NextResponse.json({ ok: true, skipped: "empty" });

  const admin = createAdminClient();

  // Кто это видел. Может не быть никого: страница входа тоже умеет падать.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Чьё это пространство — тот и должен узнать. У владельца своя строка в
  // workspace_members отсутствует, и это значит «сам себе владелец».
  let ownerId: string | null = user?.id ?? null;
  if (user) {
    const { data: member } = await admin.from("workspace_members").select("owner_id").eq("member_id", user.id).maybeSingle();
    if (member?.owner_id) ownerId = member.owner_id;
  }

  const fingerprint = fingerprintOf(message, body?.stack);

  // Предел на запись: считаем строки этого же человека за последнюю минуту.
  if (user) {
    const since = new Date(Date.now() - WRITE_WINDOW_MS).toISOString();
    const { count } = await admin
      .from("client_errors")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (tooMany(count ?? 0)) return NextResponse.json({ ok: true, skipped: "throttled" });
  }

  // Видели ли мы это раньше — спрашивается ДО вставки, иначе своя же
  // свежая строка сделает любую поломку «уже известной».
  const { data: previous } = await admin
    .from("client_errors")
    .select("created_at")
    .eq("fingerprint", fingerprint)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("client_errors").insert({
    user_id: user?.id ?? null,
    owner_id: ownerId,
    message: message.slice(0, 2000),
    stack: (body?.stack || "").slice(0, 8000) || null,
    url: (body?.url || "").slice(0, 500) || null,
    release: (body?.release || "").slice(0, 100) || null,
    fingerprint,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Сообщение владельцу — один раз на поломку, а не на каждого, кто в неё
  // упёрся. Молчание при повторе не теряет ничего: строка в журнале есть.
  if (ownerId && shouldNotify(previous?.created_at ?? null)) {
    const who = user?.email && user.id !== ownerId ? user.email : null;
    await notifyOwner(admin, ownerId, crashNotice({ message, url: body?.url, release: body?.release, who })).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
