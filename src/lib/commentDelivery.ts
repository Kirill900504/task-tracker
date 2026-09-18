import type { SupabaseClient } from "@supabase/supabase-js";
import { chatsFor, replyButtons, type ColleagueRow } from "@/lib/colleagues";
import { notifyOwner, sendToColleague } from "@/lib/botDelivery";
import { queueNotice } from "@/lib/noticeQueue";

// Кто должен услышать про сообщение в обсуждении.
//
// Обсуждение задачи было трубой в одну сторону, и это было незаметно с
// обеих. Кирилл писал в карточке — исполнитель не узнавал никогда: ни
// сразу, ни утренней сводкой. Руководитель отвечал из трекера — не узнавал
// Кирилл: сводка считала только те сообщения, что пришли из мессенджера.
// Два человека могли переписываться в одной задаче и оба быть уверены, что
// второй молчит.
//
// Правило проекта — «петля должна замыкаться»: у каждого действия есть
// тот, кто его ждёт. Здесь этих ожидающих сразу несколько, поэтому вопрос
// «кому сказать» отвечается один раз и в одном месте: участники итема,
// постановщик и владелец пространства, минус автор сообщения.

const QUIET_GAP_MS = 2 * 60 * 60 * 1000;

type CommentRow = {
  id: string;
  item_kind: "task" | "meeting" | "idea";
  item_id: string;
  body: string;
  user_id: string;
  author_user_id: string | null;
  author_assignee_id: string | null;
  system: boolean;
  created_at: string;
  attachments: { name: string }[] | null;
};

// Подпись сообщения: одна строка, по которой видно, о чём речь и от кого.
// Слово «по задаче» здесь не украшение — человек читает это в ленте, где
// рядом лежат уведомления о трёх других делах.
export function commentText(
  authorName: string,
  kind: CommentRow["item_kind"],
  title: string,
  body: string,
  fileCount = 0,
): string {
  const what = kind === "meeting" ? "по встрече" : kind === "idea" ? "по мысли" : "по задаче";
  // Файл без слов — обычное дело («вот фотография»), и пустая строка после
  // двоеточия выглядела бы как сообщение, которое не дошло.
  const tail = body.trim() || (fileCount ? `📎 ${fileCount === 1 ? "файл" : "файлов: " + fileCount}` : "");
  return `💬 ${authorName} ${what} «${title}»: ${tail}`;
}

async function itemTitle(admin: SupabaseClient, kind: CommentRow["item_kind"], id: string): Promise<string> {
  const table = kind === "task" ? "tasks" : kind === "meeting" ? "meetings" : "ideas";
  const column = kind === "idea" ? "text" : "title";
  const { data } = await admin.from(table).select(column).eq("id", id).maybeSingle();
  const value = (data as Record<string, string> | null)?.[column] || "";
  return kind === "idea" ? value.slice(0, 60) : value;
}

// Все, кто на итеме. Постановщик отдельной строкой не запрашивается: он
// всегда участник того, что завёл, — задачу без исполнителя здесь не
// заводят, а встречу и мысль заводят адресатам.
async function audience(admin: SupabaseClient, kind: CommentRow["item_kind"], itemId: string): Promise<string[]> {
  const table = kind === "task" ? "task_participants" : kind === "meeting" ? "meeting_participants" : "idea_recipients";
  const column = kind === "task" ? "task_id" : kind === "meeting" ? "meeting_id" : "idea_id";
  const { data } = await admin.from(table).select("assignee_id").eq(column, itemId);
  return ((data || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
}

// Разговор считается новым, если до него в этом итеме два часа никто не
// писал. Порог — решение проекта, не мелочь: четырнадцать человек, каждый
// со своей перепиской по каждой задаче, иначе превращают мессенджер в
// ленту, которую перестают читать целиком — вместе с «сделал» и «не могу»,
// ради которых всё затевалось. Остальное придёт утренней сводкой.
export async function isNewConversation(
  admin: SupabaseClient,
  kind: CommentRow["item_kind"],
  itemId: string,
  exceptCommentId: string,
  now = Date.now(),
): Promise<boolean> {
  const { data } = await admin
    .from("item_comments")
    .select("id, created_at")
    .eq("item_kind", kind)
    .eq("item_id", itemId)
    .is("deleted_at", null)
    .eq("system", false)
    .order("created_at", { ascending: false })
    .limit(2);

  const previous = ((data as { id: string; created_at: string }[] | null) || []).find((r) => r.id !== exceptCommentId);
  return !previous || now - Date.parse(previous.created_at) > QUIET_GAP_MS;
}

export type DeliveryResult = { delivered: number; skipped: "system" | "throttled" | "no-audience" | null };

// Разослать сообщение всем, кроме автора.
//
// Молчаливо ничего не делает для служебных строк: о принятом, возвращённом
// и отказе адресату уже сказали те маршруты, которые это сделали, и второе
// сообщение о том же было бы эхом.
export async function deliverComment(admin: SupabaseClient, commentId: string): Promise<DeliveryResult> {
  const { data } = await admin
    .from("item_comments")
    .select("id, item_kind, item_id, body, user_id, author_user_id, author_assignee_id, system, created_at, attachments")
    .eq("id", commentId)
    .maybeSingle();
  const comment = data as CommentRow | null;
  if (!comment || comment.system) return { delivered: 0, skipped: "system" };

  if (!(await isNewConversation(admin, comment.item_kind, comment.item_id, comment.id))) {
    return { delivered: 0, skipped: "throttled" };
  }

  const [title, assigneeIds] = await Promise.all([
    itemTitle(admin, comment.item_kind, comment.item_id),
    audience(admin, comment.item_kind, comment.item_id),
  ]);

  // Автор, постановщик и владелец могут оказаться одним человеком — каждый
  // получатель поэтому считается один раз, по строке в списке людей.
  const wanted = new Set(assigneeIds);
  if (comment.author_assignee_id) wanted.delete(comment.author_assignee_id);

  const { data: people } = await admin
    .from("assignees")
    .select("id, name, user_id, telegram_chat_id, max_user_id")
    .eq("user_id", comment.user_id);
  const rows = (people || []) as (ColleagueRow & { user_id: string })[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const authorName =
    (comment.author_assignee_id && byId.get(comment.author_assignee_id)?.name) ||
    (comment.author_user_id === comment.user_id ? "Кирилл" : "Коллега");

  const fileCount = (comment.attachments || []).length;
  const text = commentText(authorName, comment.item_kind, title, comment.body, fileCount);
  // Ответить можно тем же нажатием, которым читаешь: без этой кнопки
  // единственный способ ответить — найти в переписке то сообщение, которым
  // задачу присылали, а его к тому времени уже переписали.
  const buttons = comment.item_kind === "idea" ? undefined : replyButtons(comment.item_kind, comment.item_id);

  let delivered = 0;
  for (const assigneeId of wanted) {
    const person = byId.get(assigneeId);
    if (!person) continue;
    const target = chatsFor(person)[0];
    if (!target) continue;
    const result = await sendToColleague(target, text, buttons);
    if (result.ok) delivered++;
  }

  // Владелец — всегда, если он не автор: он отвечает за пространство и
  // видит в нём всё. Постановщик-руководитель отдельной строкой не нужен —
  // он стоит участником в собственном итеме и получил сообщение выше.
  //
  // Ему это идёт строкой в сводку, а не отдельным сообщением: реплика в
  // обсуждении — самое частое, что здесь происходит, и именно она первой
  // превращает мессенджер в ленту. Участникам, наоборот, уходит сразу:
  // разговор, ответ на который приходит через десять минут, — не разговор.
  if (comment.author_user_id !== comment.user_id) {
    if (await queueNotice(admin, comment.user_id, null, { kind: "comment", item: title, who: authorName, what: comment.body.trim() })) {
      delivered++;
    } else {
      delivered += await notifyOwner(admin, comment.user_id, text);
    }
  }

  return { delivered, skipped: delivered ? null : "no-audience" };
}
