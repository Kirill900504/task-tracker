"use client";

import { createClient } from "@/lib/supabase/client";
import { BUCKET, type Attachment } from "@/hooks/useItemComments";
import { me } from "@/lib/me";

// Документы к отчёту: положить в корзину и получить ссылку на час.
//
// Корзина та же, что у обсуждения (`item-files`), и это не экономия: права
// на неё решают по ПЕРВОМУ сегменту пути — id пространства (миграция 0020).
// Вторая корзина означала бы вторые политики, которые разойдутся с первыми,
// и второй набор подписанных ссылок.
//
// Загружает браузер, а не маршрут. Содержимое файла через серверную функцию
// не гоняют: у неё свой предел на тело запроса и четыре с половиной секунды
// на всё, а фотография акта — это два мегабайта. Маршрут получает только
// описания (см. api/workspace/report) и записывает их в task_participants.

// 20 МБ — предел корзины. Сказать об этом до загрузки дешевле, чем дать
// человеку дождаться отказа на последнем байте.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function tooBigFile(files: File[]): File | null {
  return files.find((f) => f.size > MAX_FILE_BYTES) || null;
}

export async function uploadResultFiles(taskId: string, files: File[]): Promise<Attachment[]> {
  if (!files.length) return [];
  const db = createClient();
  const { workspaceId } = await me();
  const out: Attachment[] = [];
  for (const file of files) {
    // Имя чистится и обрезается: в путь корзины идут только буквы, цифры,
    // точка и дефис — кириллица и пробелы в ключе объекта превращаются в
    // проценты, а ключ потом читают глазами в журнале.
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${workspaceId}/task/${taskId}/result/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) throw new Error(`Не загрузился файл «${file.name}»: ${error.message}`);
    out.push({ path, name: file.name, size: file.size, type: file.type });
  }
  return out;
}

// Ссылки живут час и запрашиваются заново при каждом открытии карточки:
// корзина закрытая, постоянного адреса у файла нет по замыслу. Одной пачкой
// на все отчёты задачи — по одной на файл это был бы запрос на каждую
// строчку результата.
export async function signResultFiles(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const db = createClient();
  const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  for (const item of data || []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}
