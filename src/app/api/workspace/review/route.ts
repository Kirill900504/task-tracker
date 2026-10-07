import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readInput, reviewInput } from "@/lib/apiInput";
import { taskButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { recordEvent } from "@/lib/itemHistory";
import { applyReview, type ReviewAction } from "@/lib/reviewWork";
import { actorName, withoutSelfMark } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";
import { isSelfAssignee } from "@/lib/trackerRows";

// Решение постановщика по отчёту: принять, вернуть, закрыть волевым.
//
// Зеркало /api/workspace/report. Тот маршрут доносит ответ исполнителя до
// владельца; этот — решение владельца до исполнителей. Без него возврат на
// доработку узнавался только из утренней сводки: задача, которую ждут
// сегодня, лежала бы до завтра просто потому, что человеку не сказали.
//
// Принятая работа закрывает задачу — здесь же, одной записью.
//
// Раньше здесь писалось только состояние приёмки, а `status` переключала
// вкладка сразу после ответа маршрута: им владеет движок синхронизации, и
// запись мимо него в принципе может откатиться (см. taskToRow). Но у этого
// порядка оказалась гонка, и она стоила Кириллу закрытой задачи: маршрут
// менял строку задачи, эхо realtime возвращалось в браузер и заменяло и
// live, и shadow серверной строкой — то есть стирало ещё не отправленное
// «сделано», поставленное миллисекундой раньше. Отчёт принят, комментарий
// записан, а задача осталась открытой.
//
// Поэтому закрытие едет вместе с приёмкой в одном UPDATE: что бы ни пришло
// эхом, там уже `done`. Вкладка всё равно переключает статус у себя (см.
// TasksPanel) — но теперь обе стороны говорят одно и то же, а значит
// перезаписать друг друга не могут.

// Что принимает этот маршрут, описано схемой в lib/apiInput.ts: там же
// живут и проверка, и тип. Отдельного `type Body` больше нет — два
// описания одного и того же расходятся, это в проекте случалось трижды.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, reviewInput);
  if (badInput) return badInput;

  const admin = createAdminClient();
  const { data: taskRow } = await admin
    .from("tasks")
    .select("id, title, user_id, created_by, status")
    .eq("id", body.taskId)
    .is("deleted_at", null)
    .maybeSingle();
  const task = taskRow as { id: string; title: string; user_id: string; created_by: string | null; status: string } | null;
  if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });

  // Принимает работу тот, кто её поручил — и только он, даже когда он же
  // владелец пространства.
  //
  // До 23.09.2026 здесь стояло «владелец пространства ИЛИ автор», и владелец
  // проходил эту проверку на ЛЮБОЙ задаче своего пространства, включая те,
  // что поставил ему кто-то из руководителей. Слова Кирилла об этом прямые:
  // «я должен быть на одном уровне прав со всеми пользователями… никто не
  // должен мочь её нарушать, даже я». Правило то же, что в интерфейсе
  // (lib/ownership.isCreatedByMe): пустой created_by значит «поставил
  // владелец сам», и тогда решает он; непустой значит «поставил
  // руководитель», и решает он один — даже если исполнитель на задаче сам
  // владелец.
  const isAuthor = task.created_by ? task.created_by === user.id : task.user_id === user.id;
  if (!isAuthor) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });

  const comment = (body.comment || "").trim();

  // Вернуть на доработку ОДНОГО исполнителя, не трогая остальных.
  //
  // Отзыв Витовского 25.09.2026: «сделал задачу на двоих, один отчитался —
  // но я не могу вернуть задачу в работу, пока не дождусь второго… один
  // сотрудник не должен зависеть от другого». Возврат был только общим и
  // только с приёмки, то есть отчёт первого лежал без ответа, пока не
  // отчитается второй. Здесь снимается отчёт (или отказ) одного человека;
  // задача, стоявшая на приёмке, возвращается в работу, потому что
  // «ответили все» больше не правда.
  if (body.action === "return_one") {
    if (!comment) return NextResponse.json({ error: "Напишите, что доделать" }, { status: 400 });
    const { data: partRow } = await admin
      .from("task_participants")
      .select("id, assignee_id, task_id, role")
      .eq("id", body.participantId || "")
      .maybeSingle();
    const one = partRow as { id: string; assignee_id: string; task_id: string; role: string } | null;
    if (!one || one.task_id !== task.id) return NextResponse.json({ error: "Этого человека нет на задаче" }, { status: 404 });
    await admin
      .from("task_participants")
      .update({ done_at: null, done_comment: null, done_files: [], declined_at: null, decline_reason: null })
      .eq("id", one.id);
    await admin.from("tasks").update({ approval_state: "open" }).eq("id", task.id).eq("approval_state", "awaiting_review");
    const { data: personRow } = await admin
      .from("assignees")
      .select("id, name, telegram_chat_id, max_user_id")
      .eq("id", one.assignee_id)
      .maybeSingle();
    const person = personRow as ColleagueRow | null;
    const label = await actorName(admin, task.user_id, user.id);
    await recordEvent(admin, {
      actorUserId: user.id,
      userId: task.user_id,
      kind: "task",
      itemId: task.id,
      text: `↩ ${label} вернул на доработку ${person ? withoutSelfMark(person.name) : "исполнителю"}: ${comment}`,
    });
    if (person) {
      await sendToPerson(admin, task.user_id, person, `↩ Вернули на доработку: «${task.title}»

${label}: ${comment}`, taskButtons(task.id, "executor"), { kind: "task", itemId: task.id });
    }
    return NextResponse.json({ ok: true });
  }

  // Срок двинули — и об этом должны узнать те, кто по нему работает.
  //
  // До сих пор перенос срока не оставлял следа нигде: старая дата просто
  // исчезала. Спросить «сколько раз эту задачу двигали» было нельзя, а это
  // первый вопрос к задаче, которая тянется третий месяц. И, что хуже,
  // человек не узнавал вовсе: он планировал неделю под прежнее число.
  //
  // Сам срок сюда не пишется — им владеет движок синхронизации, и запись
  // мимо него откатится первой же открытой вкладкой. Здесь только строка в
  // хронику и сообщение людям.
  if (body.action === "deadline") {
    const to = (body.date || "").trim();
    const was = (body.comment || "").trim();
    const moved = to ? (was ? "перенесён с " + fmtDate(was) + " на " + fmtDate(to) : "поставлен на " + fmtDate(to)) : "снят";
    await recordEvent(admin, {
      actorUserId: user.id,
      userId: task.user_id,
      kind: "task",
      itemId: task.id,
      text: "📅 Срок " + moved,
    });

    const { data: parts } = await admin
      .from("task_participants")
      .select("assignee_id")
      .eq("task_id", task.id)
      .in("role", ["executor", "coexecutor"]);
    // Тот, кто двинул срок, о нём уже знает — и у задачи самому себе это
    // единственный исполнитель: сообщение «новый срок» самому себе — шум.
    // Его строка — по членству, у владельца — по метке «(я)».
    const { data: memberRow } = await admin
      .from("workspace_members")
      .select("assignee_id")
      .eq("member_id", user.id)
      .eq("owner_id", task.user_id)
      .maybeSingle();
    const actorAssignee = (memberRow as { assignee_id: string | null } | null)?.assignee_id || "";
    const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id).filter((id) => id !== actorAssignee);
    if (ids.length) {
      const { data: found } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
      const people = ((found || []) as ColleagueRow[]).filter((p) => !(user.id === task.user_id && isSelfAssignee(p.name || "")));
      const text = to
        ? "📅 Новый срок по задаче «" + task.title + "»: " + fmtDate(to)
        : "📅 С задачи «" + task.title + "» сняли срок";
      // К сведению — без кнопок, по той же причине, что и ответ на просьбу
      // о переносе ниже. Всем сразу, а не по очереди.
      await Promise.all(people.map((person) => sendToPerson(admin, task.user_id, person, text)));
    }
    return NextResponse.json({ ok: true });
  }

  // Решение по просьбе о переносе.
  //
  // Просьба была видна, решение — нет: вкладка просто стирала строку, и
  // человек, попросивший срок, не узнавал ответа ни в какой форме. Для него
  // это выглядит одинаково и когда срок двинули, и когда отказали, и когда
  // просто не заметили — то есть худшим из трёх способов.
  //
  // Сам срок здесь не двигается: им владеет движок синхронизации, и запись
  // мимо него откатится первой же открытой вкладкой (см. правило про
  // приёмку в CLAUDE.md). Вкладка сохраняет задачу как обычно, маршрут
  // закрывает просьбу и говорит человеку.
  if (body.action === "moved" || body.action === "kept") {
    if (!body.participantId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
    const { data: partRow } = await admin
      .from("task_participants")
      .select("id, task_id, assignee_id, reschedule_to, reschedule_reason")
      .eq("id", body.participantId)
      .maybeSingle();
    const part = partRow as { id: string; task_id: string; assignee_id: string; reschedule_to: string | null } | null;
    if (!part || part.task_id !== task.id) return NextResponse.json({ error: "Просьба не найдена" }, { status: 404 });

    await admin
      .from("task_participants")
      .update({ reschedule_requested_at: null, reschedule_to: null, reschedule_reason: null })
      .eq("id", part.id);

    const when = body.date || part.reschedule_to;
    const moved = body.action === "moved";
    await recordEvent(admin, {
      actorUserId: user.id,
      userId: task.user_id,
      kind: "task",
      itemId: task.id,
      text: moved
        ? `📅 Срок перенесён${when ? " на " + fmtDate(when) : ""}${comment ? ": " + comment : ""}`
        : `📅 В переносе отказано${comment ? ": " + comment : ""}`,
    });

    const { data: person } = await admin
      .from("assignees")
      .select("id, name, telegram_chat_id, max_user_id")
      .eq("id", part.assignee_id)
      .maybeSingle();
    if (person) {
      await sendToPerson(
        admin,
        task.user_id,
        person as ColleagueRow,
        moved
          ? `📅 Срок перенесён: «${task.title}»${when ? "\nНовый срок: " + fmtDate(when) : ""}${comment ? "\n\n" + comment : ""}`
          : `📅 Срок остаётся прежним: «${task.title}»${comment ? "\n\n" + comment : ""}`,
        // Без кнопок: это уведомление «к сведению», отвечать на него нечем
        // и незачем. Под ним стояли «Принял / Сделал / Не могу / Прошу
        // перенос», и Игорь Витковский прочёл это как вопрос, на который
        // надо выбрать ответ (отзыв 25.09.2026). Так же уже пишет бот,
        // когда срок продлевают из мессенджера (tellAssignees).
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Принято, возвращено, закрыто волевым — всё это правила, и живут они в
  // lib/reviewWork: те же кнопки есть теперь в мессенджере, и второй
  // экземпляр этих правил разошёлся бы с первым (в этом проекте так уже
  // было трижды). Маршрут отвечает за своё — что решение принимает тот,
  // кто вправе.
  const result = await applyReview(
    admin,
    { id: task.id, title: task.title, user_id: task.user_id, status: task.status },
    body.action as ReviewAction,
    comment,
    { label: await actorName(admin, task.user_id, user.id), userId: user.id },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
