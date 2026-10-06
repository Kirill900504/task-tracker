"use client";

import { createClient } from "@/lib/supabase/client";
import { BUCKET, type Attachment } from "@/hooks/useItemComments";
import { me } from "@/lib/me";

// Документы к ЛЮБОМУ ответу, кроме отчёта: отказ, просьба о переносе,
// «не смогу» на встречу, итог встречи, приёмка, возврат, волевое закрытие.
//
// У отчёта для документов есть своя колонка (task_participants.done_files,
// миграция 0039), потому что их смотрят в момент приёмки. Остальным ответам
// заводить по колонке значило бы семь колонок одной формы в пяти таблицах и
// семь мест, где их надо показать. Им уже есть дом: каждый такой ответ
// пишет строку в обсуждение элемента (lib/itemHistory), и документ ложится
// туда же следующим сообщением — от имени того, кто ответил, с подписью, к
// чему он. Обсуждение уже умеет файлы, подписанные ссылки, видимость и
// доставку в мессенджер — второй раз всё это не пишется.
//
// Порядок — как у отчёта: «отчёт, чей файл не загрузился, не уходит
// вовсе». Сначала файлы в корзину, потом сам ответ, потом сообщение с
// ними. Не загрузилось — ответ не отправлен, и человек видит причину в той
// же форме, а не узнаёт потом, что причину отказа прочли без письма,
// которое её объясняло.

export type AnswerItem = { kind: "task" | "meeting"; id: string };

async function upload(item: AnswerItem, files: File[]): Promise<Attachment[]> {
  const db = createClient();
  const { workspaceId } = await me();
  const out: Attachment[] = [];
  for (const file of files) {
    // Путь как у обсуждения: первый сегмент — пространство, по нему корзина
    // решает права (миграция 0020).
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${workspaceId}/${item.kind}/${item.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) throw new Error(`Не загрузился файл «${file.name}»: ${error.message}`);
    out.push({ path, name: file.name, size: file.size, type: file.type });
  }
  return out;
}

async function post(item: AnswerItem, label: string, attachments: Attachment[]): Promise<void> {
  const db = createClient();
  const { userId, assigneeId } = await me();
  const { data, error } = await db
    .from("item_comments")
    .insert({
      item_kind: item.kind,
      item_id: item.id,
      body: label,
      attachments,
      author_user_id: userId || null,
      author_assignee_id: assigneeId,
      source: "app",
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Ответ ушёл, а документы не прикрепились: ${error.message}`);
  // Рассылка — тем же маршрутом, что у обычного сообщения: правило «кому
  // сказать» одно (commentDelivery). Не дошла — скажет утренняя сводка.
  if (data?.id) {
    void fetch("/api/workspace/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: data.id }),
    }).catch(() => {});
  }
}

// Выполнить ответ вместе с документами. Без файлов — ровно сам ответ.
// `label` — подпись к сообщению: «Документы к отказу» и т. п.; по ней в
// обсуждении понятно, к какому решению они приложены.
export async function answerWithFiles<T>(item: AnswerItem | null | undefined, files: File[], label: string, action: () => Promise<T> | T): Promise<T> {
  if (!files.length || !item?.id) return await action();
  const attachments = await upload(item, files);
  const result = await action();
  await post(item, label, attachments);
  return result;
}
