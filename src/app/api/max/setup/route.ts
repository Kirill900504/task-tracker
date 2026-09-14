import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maxBotInfo, subscribeMaxWebhook } from "@/lib/max";
import { forgetMaxSettings } from "@/lib/botSettings";
import { ensureBotSettingsTable, looksLikeMissingTable } from "@/lib/ensureBotSettings";

// Подключение бота MAX — целиком, одним действием.
//
// Единственное, что может сделать только человек, — завести бота в кабинете
// MAX для бизнеса (business.max.ru) и забрать выданный токен; MasterBot этого
// больше не делает. Всё остальное (проверить токен, узнать имя бота,
// придумать секрет, подписать вебхук, сохранить) делается здесь,
// потому что каждый из этих шагов по отдельности — это ещё один экран,
// который владельцу пришлось бы пройти самому.
//
// Порядок важен: сначала спрашиваем MAX, потом пишем в базу. Иначе неверный
// токен остался бы сохранённым, бот молча не работал бы, и разбираться с
// этим пришлось бы по симптому «никому ничего не приходит».

// Обновления, на которые подписывается бот: сообщение, нажатая кнопка и
// первое открытие бота (в нём приходит код из ссылки-приглашения).
const UPDATE_TYPES = ["message_created", "message_callback", "bot_started"];

// Адрес этого развёртывания глазами внешнего мира. За прокси Vercel req.url
// показывает внутренний адрес, поэтому идём по заголовкам — вебхук должен
// указывать на публичный домен, иначе MAX не достучится.
function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

function randomSecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// Бот один на всю установку, поэтому подключать его может только владелец
// пространства. Руководитель, принятый в чужое пространство, — не владелец.
async function requireOwner(): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Не авторизован" };

  const admin = createAdminClient();
  const { data } = await admin.from("workspace_members").select("owner_id").eq("member_id", user.id).maybeSingle();
  const ownerId = (data as { owner_id?: string } | null)?.owner_id;
  if (ownerId && ownerId !== user.id) {
    return { ok: false, status: 403, error: "Бота подключает владелец трекера" };
  }
  return { ok: true, userId: user.id };
}

type Public = { connected: boolean; username: string; name: string; connectedAt: string | null };

// Первое обращение к странице заводит таблицу, если её ещё нет: применять
// миграцию отдельно — это ещё один экран для того, кому и одного много
// (см. ensureBotSettings.ts). Дальше это обычное чтение.
async function currentState(): Promise<{ state: Public } | { error: string }> {
  const admin = createAdminClient();
  const columns = "max_bot_token, max_bot_username, max_bot_name, max_connected_at";
  let { data, error } = await admin.from("bot_settings").select(columns).eq("id", true).maybeSingle();

  if (error && looksLikeMissingTable(error)) {
    const created = await ensureBotSettingsTable();
    if (!created.ok) return { error: created.error };
    ({ data, error } = await admin.from("bot_settings").select(columns).eq("id", true).maybeSingle());
  }
  if (error) return { error: error.message };

  const row = data as Record<string, string | null> | null;
  return {
    state: {
      // Сам токен наружу не отдаётся никогда — ни целиком, ни куском.
      connected: !!row?.max_bot_token,
      username: row?.max_bot_username || "",
      name: row?.max_bot_name || "",
      connectedAt: row?.max_connected_at || null,
    },
  };
}

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const result = await currentState();
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.state);
}

export async function POST(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as { token?: string; action?: string } | null;

  if (body?.action === "disconnect") {
    const admin = createAdminClient();
    const { error } = await admin
      .from("bot_settings")
      .update({ max_bot_token: null, max_webhook_secret: null, max_bot_username: null, max_bot_name: null, max_connected_at: null, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    forgetMaxSettings();
    const after = await currentState();
    return NextResponse.json("error" in after ? { error: after.error } : after.state);
  }

  // Токен переживает копирование из мессенджера: лишние пробелы и перевод
  // строки прилипают к нему сами собой, и ругаться на них — значит послать
  // человека искать несуществующую ошибку.
  const token = (body?.token || "").trim();
  if (!token) return NextResponse.json({ error: "Вставьте токен, который выдал кабинет MAX для бизнеса" }, { status: 400 });

  // Таблица должна существовать ДО того, как мы пойдём в MAX: иначе бот
  // окажется подписан на вебхук, а токен сохранить будет некуда.
  const ready = await currentState();
  if ("error" in ready) return NextResponse.json({ error: ready.error }, { status: 500 });

  const info = await maxBotInfo(token);
  if (!info.ok) {
    return NextResponse.json({ error: "MAX не принял этот токен: " + info.error }, { status: 400 });
  }
  if (!info.username) {
    return NextResponse.json(
      { error: "Токен рабочий, но у бота нет имени (@username). Задайте адрес бота в кабинете MAX для бизнеса и вставьте токен ещё раз." },
      { status: 400 },
    );
  }

  const secret = randomSecret();
  const url = publicOrigin(req) + "/api/max/webhook";
  const subscribed = await subscribeMaxWebhook(token, url, secret, UPDATE_TYPES);
  if (!subscribed.ok) {
    return NextResponse.json({ error: "Не удалось подписать вебхук: " + subscribed.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("bot_settings").upsert(
    {
      id: true,
      max_bot_token: token,
      max_webhook_secret: secret,
      max_bot_username: info.username,
      max_bot_name: info.name,
      max_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Иначе минуту после подключения всё ещё действует «бота нет».
  forgetMaxSettings();
  const after = await currentState();
  if ("error" in after) return NextResponse.json({ error: after.error }, { status: 500 });
  return NextResponse.json({ ...after.state, webhook: url });
}
