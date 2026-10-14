import type { SupabaseClient } from "@supabase/supabase-js";
import { replyButtons, type ColleagueRow } from "@/lib/colleagues";
import { notifyAuthor } from "@/lib/botDelivery";
import { sendToPerson } from "@/lib/reach";
import { taskRef } from "@/lib/taskRef";
import { actorName, withoutSelfMark } from "@/lib/actorName";
import { organizerRowId, proposalAcceptButtons, proposalVoteButtons, proposalWhen, type Proposal } from "@/lib/meetingProposal";

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
// «кому сказать» отвечается один раз и в одном месте: участники итема и
// постановщик, минус автор сообщения. Владелец пространства — только как
// один из них (14.10.2026, см. ниже).

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
  // Номер задачи (миграция 0045) — для ориентира, как во всех сообщениях
  // бота (lib/taskRef). У встреч и мыслей номера нет.
  num: number | null = null,
): string {
  const what = kind === "meeting" ? "по встрече" : kind === "idea" ? "по мысли" : "по задаче";
  // Файл без слов — обычное дело («вот фотография»), и пустая строка после
  // двоеточия выглядела бы как сообщение, которое не дошло.
  const tail = body.trim() || (fileCount ? `📎 ${fileCount === 1 ? "файл" : "файлов: " + fileCount}` : "");
  return `💬 ${authorName} ${what} ${taskRef({ title, number: num })}: ${tail}`;
}

// Название, номер и автор дела — одним запросом.
//
// Автор: здесь стояло «постановщик отдельной строкой не нужен — он всегда
// участник того, что завёл», и это было правдой ровно до тех пор, пока
// заводил один владелец. Руководитель, поставивший задачу Игорю, участником
// НЕ становится — участники задачи это исполнители, соисполнители и
// наблюдатели, — и ответ Игоря в обсуждении не доходил до него ни сразу,
// ни сводкой. То есть ровно то, ради чего этот файл написан: двое
// переписываются, и один из них об этом не знает.
async function itemInfo(
  admin: SupabaseClient,
  kind: CommentRow["item_kind"],
  id: string,
): Promise<{ title: string; number: number | null; createdBy: string | null }> {
  const table = kind === "task" ? "tasks" : kind === "meeting" ? "meetings" : "ideas";
  const columns = kind === "task" ? "title, number, created_by" : kind === "idea" ? "text, created_by" : "title, created_by";
  const { data } = await admin.from(table).select(columns).eq("id", id).maybeSingle();
  const row = (data || {}) as { title?: string; text?: string; number?: number | null; created_by?: string | null };
  const title = kind === "idea" ? (row.text || "").slice(0, 60) : row.title || "";
  return { title, number: row.number ?? null, createdBy: row.created_by ?? null };
}

// Все, кто на итеме.
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
    .select("id, item_kind, item_id, body, user_id, author_user_id, author_assignee_id, system, created_at, attachments, proposal")
    .eq("id", commentId)
    .maybeSingle();
  const comment = data as (CommentRow & { proposal?: unknown }) | null;
  if (!comment || comment.system) return { delivered: 0, skipped: "system" };

  // Предложение другого времени уходит сразу, без порога «первое после
  // паузы»: на него ждут ответа от каждого, и до утренней сводки встреча
  // может уже начаться.
  if (!comment.proposal && !(await isNewConversation(admin, comment.item_kind, comment.item_id, comment.id))) {
    return { delivered: 0, skipped: "throttled" };
  }

  const [{ title, number, createdBy }, assigneeIds] = await Promise.all([
    itemInfo(admin, comment.item_kind, comment.item_id),
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

  // Имя, а не роль и не подставленное «Кирилл». Раньше здесь стояли ровно
  // эти два слова: своё имя владельца и «Коллега» для всех остальных, —
  // то есть реплика руководителя приходила подписанной «Коллега» тому,
  // кто с ним в этой задаче и работает. Имя ищется по строке человека, а
  // если её нет (реплика пришла логином без строки) — по членству.
  const authorName =
    withoutSelfMark((comment.author_assignee_id && byId.get(comment.author_assignee_id)?.name) || "") ||
    (comment.author_user_id ? await actorName(admin, comment.user_id, comment.author_user_id, "Участник") : "Участник");

  // Предложение другого времени — отдельной дорогой: у участников под ним
  // «👍 Подходит / 👎 Не подходит», у организатора — «📅 Перенести на это
  // время» (lib/meetingProposal). Организатору — сразу, а не строкой в
  // сводку: решать ему, и до сводки встреча может уже начаться.
  const proposal = comment.proposal as Proposal | null | undefined;
  if (comment.item_kind === "meeting" && proposal?.date) {
    const organizer = await organizerRowId(admin, { user_id: comment.user_id, created_by: createdBy });
    const reason = (comment.body.split(" — ")[1] || "").split(".\n")[0].trim();
    const head = `🕐 ${authorName} предлагает перенести встречу «${title}» на ${proposalWhen(proposal)}${reason ? `\n\n${reason}` : ""}`;
    const sends: Promise<number>[] = [];
    for (const assigneeId of wanted) {
      const person = byId.get(assigneeId);
      if (!person || assigneeId === organizer) continue;
      sends.push(sendToPerson(admin, comment.user_id, person, head + "\n\nПодходит вам?", proposalVoteButtons(comment.id)));
    }
    const org = organizer && organizer !== comment.author_assignee_id ? byId.get(organizer) : undefined;
    if (org) {
      sends.push(
        sendToPerson(admin, comment.user_id, org, head + "\n\nУчастники ответят 👍 / 👎 — решаете вы.", [
          ...proposalAcceptButtons(comment.id),
          ...replyButtons("meeting", comment.item_id),
        ]),
      );
    }
    const counts = await Promise.all(sends);
    const total = counts.reduce((a, b) => a + b, 0);
    return { delivered: total, skipped: total ? null : "no-audience" };
  }

  const fileCount = (comment.attachments || []).length;
  const text = commentText(authorName, comment.item_kind, title, comment.body, fileCount, number);
  // Ответить можно тем же нажатием, которым читаешь: без этой кнопки
  // единственный способ ответить — найти в переписке то сообщение, которым
  // задачу присылали, а его к тому времени уже переписали.
  const buttons = comment.item_kind === "idea" ? undefined : replyButtons(comment.item_kind, comment.item_id);

  let delivered = 0;
  for (const assigneeId of wanted) {
    const person = byId.get(assigneeId);
    if (!person) continue;
    // Строка владельца чата не несёт — его чаты берутся у lib/reach.
    delivered += await sendToPerson(admin, comment.user_id, person, text, buttons);
  }

  // Постановщику — если он не автор этой реплики и не стоит участником сам
  // (тогда ему уже ушло). Строкой в сводку, а не отдельным сообщением:
  // реплика в обсуждении — самое частое, что здесь происходит, и именно она
  // первой превращает мессенджер в ленту. Участникам, наоборот, уходит
  // сразу: разговор, ответ на который приходит через десять минут, — не
  // разговор.
  //
  // Постановщик владельца — сам владелец: `created_by` у его строк пуст.
  // Отдельной ветки «владельцу — всегда, он видит всё» здесь больше нет
  // (14.10.2026): видимость в трекере своя у каждого, владелец включительно
  // (lib/itemVisibility), и сводка с чужими переписками по задачам, которых
  // он не видит на доске, была той самой лентой — и вторым экземпляром
  // каждой реплики там, где он и постановщик, и участник.
  const authorId = createdBy || comment.user_id;
  if (authorId !== comment.author_user_id) {
    // Его собственная строка в списке людей: у руководителя — по членству
    // (в `assignees` колонка `user_id` означает владельца пространства, а
    // не человека), у владельца — строка с пометкой «(я)».
    let ownRow: string | undefined;
    if (createdBy && createdBy !== comment.user_id) {
      const { data: memberRow } = await admin
        .from("workspace_members")
        .select("assignee_id")
        .eq("member_id", createdBy)
        .eq("owner_id", comment.user_id)
        .maybeSingle();
      ownRow = (memberRow as { assignee_id?: string } | null)?.assignee_id;
    } else {
      ownRow = rows.find((r) => /\(я\)\s*$/.test(r.name))?.id;
    }
    if (!ownRow || !wanted.has(ownRow)) {
      await notifyAuthor(admin, comment.user_id, createdBy, text, {
        kind: "comment",
        item: title,
        itemId: comment.item_id,
        num: number,
        who: authorName,
        what: comment.body.trim() || (fileCount ? "📎 приложены документы" : ""),
      });
      delivered++;
    }
  }

  return { delivered, skipped: delivered ? null : "no-audience" };
}
