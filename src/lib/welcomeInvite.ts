import type { SupabaseClient } from "@supabase/supabase-js";
import { randomCode } from "@/lib/botInvite";

// Приглашение «всё в одном» (28.10.2026, его слова: «самый современный и
// простой способ отправлять приглашения, скачивать людям десктопное
// приложение и присоединяться к ботам»).
//
// До этого человеку присылали ТРИ разные вещи: ссылку на Telegram, ссылку на
// MAX и ссылку «в трекер» с паролем, — и каждая жила своим сроком и своей
// кнопкой в «Команде». Теперь ссылка одна, на страницу /welcome/<код>, где
// человек видит своё имя и три шага: подключить бота (он сам выбирает, какой
// мессенджер у него есть), открыть трекер на телефоне (он уже в боте) и
// скачать приложение для компьютера (вход в нём — через того же бота, без
// пароля, см. lib/messengerLogin).
//
// Отдельной таблицы под это нет: код — та же строка в telegram_link_codes,
// что и у прежних приглашений, только с каналом «any» — его принимают оба
// бота. И он НЕ сгорает при первом нажатии «Start», как прежние: по той же
// ссылке человек потом подключает второй мессенджер и скачивает приложение,
// а страница отвечает «✓ подключено». Перехватить чужое имя таким кодом
// после подключения нельзя — botPipeline отказывает, если у человека в этом
// мессенджере уже другой чат.

export const WELCOME_CHANNEL = "any";
// Неделя, а не трое суток: эту ссылку рассылают всем разом, и кто-то
// откроет её только в понедельник.
export const WELCOME_DAYS = 7;

export function welcomeLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/welcome/${code}`;
}

// Выписать код человеку. Прежний неиспользованный «any» уходит: двум живым
// приглашениям одного человека взяться неоткуда, кроме повторного нажатия,
// а старое при этом должно перестать работать.
export async function issueWelcomeCode(
  admin: SupabaseClient,
  spaceId: string,
  assigneeId: string,
): Promise<{ code: string } | { error: string }> {
  await admin.from("telegram_link_codes").delete().eq("assignee_id", assigneeId).eq("channel", WELCOME_CHANNEL);
  const code = randomCode();
  const expiresAt = new Date(Date.now() + WELCOME_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin
    .from("telegram_link_codes")
    .insert({ code, user_id: spaceId, assignee_id: assigneeId, channel: WELCOME_CHANNEL, expires_at: expiresAt });
  if (error) return { error: error.message };
  return { code };
}

// Готовый текст, который владелец вставляет в чат человеку. Сам трекер
// написать неподключённому не может — в этом всё дело, — поэтому слова
// даются целиком, чтобы не сочинять их четырнадцать раз.
//
// Установщик идёт в тексте прямой ссылкой (29.10.2026, его просьба после
// «у Черкашина не запускается трекер с компа»): ссылка на файл ведёт на
// GitHub, а не на наш *.vercel.app, который часть российских сетей режет по
// имени, — то есть скачать приложение можно и там, где страница
// приглашения не открылась.
export function welcomeMessage(name: string, link: string, installerUrl = ""): string {
  const first = name.trim().split(/\s+/)[0] || "";
  return (
    `${first ? first + ", привет" : "Привет"}! Подключайся к нашему планировщику задач — ` +
    `сюда будут приходить задачи и встречи. Всё по одной ссылке, займёт минуту:\n${link}\n\n` +
    (installerUrl ? `Приложение для компьютера (Windows) — скачать сразу:\n${installerUrl}\n\n` : "") +
    // «Мои данные» — второй шаг (28.10.2026, его «да, добавь»): трекер и
    // сам напомнит точкой на имени, но сказанное заранее заполняют чаще.
    "После входа загляни в «Личный кабинет» (своё имя вверху) и заполни рабочую почту, телефон и пароль."
  );
}

// Установщик для Windows — прямой ссылкой на файл последнего выпуска.
//
// Имя файла содержит версию (Planirovshchik-Zadach-Setup-1.0.10.exe), поэтому
// постоянной ссылки на сам файл у GitHub нет, а ссылка на страницу выпуска —
// это список из пяти файлов, где человек должен угадать нужный. Поэтому
// адрес спрашивается у API выпусков (репозиторий публичный, ключ не нужен) и
// держится час; не ответил — страница выпуска, это хуже, но работает.
const RELEASES_PAGE = "https://github.com/Kirill900504/task-tracker/releases/latest";

export async function desktopInstallerUrl(): Promise<{ url: string; version: string }> {
  try {
    const res = await fetch("https://api.github.com/repos/Kirill900504/task-tracker/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { url: RELEASES_PAGE, version: "" };
    const data = (await res.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const exe = (data.assets || []).find((a) => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name));
    return { url: exe?.browser_download_url || RELEASES_PAGE, version: (data.tag_name || "").replace(/^v/, "") };
  } catch {
    return { url: RELEASES_PAGE, version: "" };
  }
}
