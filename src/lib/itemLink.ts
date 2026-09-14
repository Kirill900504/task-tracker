import { createClient } from "@/lib/supabase/client";

// Задача и встреча, выросшая из неё.
//
// Задачу нельзя превратить во встречу — она никуда не девается; по ней
// собираются, и через месяц важно помнить, когда именно и чем кончилось.
// Связь записывается строкой в обсуждение обеих сторон, а не колонкой:
// читать её будет человек, а не запрос, и видит он её там же, где всё
// остальное по этому делу. Заодно это не требует менять базу.
export async function linkTaskAndMeeting(
  taskId: string,
  taskTitle: string,
  meetingId: string,
  meetingTitle: string,
  when: string,
): Promise<void> {
  const db = createClient();
  const { data: me } = await db.auth.getUser();
  const author = me?.user?.id || null;

  const rows = [
    {
      item_kind: "task" as const,
      item_id: taskId,
      body: `📅 По этой задаче назначена встреча «${meetingTitle}» — ${when}.`,
      author_user_id: author,
      source: "app" as const,
    },
    {
      item_kind: "meeting" as const,
      item_id: meetingId,
      body: taskTitle ? `📋 Встреча по задаче «${taskTitle}».` : "📋 Встреча выросла из задачи.",
      author_user_id: author,
      source: "app" as const,
    },
  ];

  // Молча: отметка полезная, но не настолько, чтобы из-за неё падало
  // сохранение встречи.
  await db.from("item_comments").insert(rows).then(
    () => undefined,
    () => undefined,
  );
}
