import { queuePost } from "@/lib/outbox";

// «Видел»: человек открыл задачу или встречу, в которой он участвует.
//
// Отметку пишет маршрут (/api/workspace/report, action «seen», миграция
// 0042), а зовут её окна задачи и встречи при открытии. Молча и без
// ожидания: это сведение для постановщика, а не действие человека, и ни
// ошибка сети, ни медленный ответ не должны ничего менять на экране.
//
// Одна отметка на строку за открытие вкладки: окно задачи перерисовывается
// десятки раз, пока его читают, и запрос на каждую перерисовку был бы шумом.
const sent = new Set<string>();

export function markSeen(kind: "task" | "meeting", participantId: string | undefined | null) {
  if (!participantId || sent.has(kind + participantId)) return;
  sent.add(kind + participantId);
  // Без связи отметка ждёт в очереди (lib/outbox): «видел» без интернета —
  // тоже «видел», и постановщик должен об этом узнать.
  queuePost("/api/workspace/report", { action: "seen", kind, participantId });
}
