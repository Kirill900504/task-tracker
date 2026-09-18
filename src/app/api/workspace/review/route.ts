import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatsFor, replyButtons, taskButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { recordEvent } from "@/lib/itemHistory";
import { fmtDate } from "@/lib/taskDisplay";

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

type Body = {
  action: "approve" | "return" | "force" | "moved" | "kept";
  taskId: string;
  comment?: string;
  // Только для решения по переносу: чью просьбу закрываем и какой срок
  // поставили.
  participantId?: string;
  date?: string | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action || !body.taskId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });

  const admin = createAdminClient();
  const { data: taskRow } = await admin
    .from("tasks")
    .select("id, title, user_id, created_by")
    .eq("id", body.taskId)
    .is("deleted_at", null)
    .maybeSingle();
  const task = taskRow as { id: string; title: string; user_id: string; created_by: string | null } | null;
  if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });

  // Принимает работу тот, кто её поручил: владелец пространства или
  // руководитель, поставивший задачу сам. Исполнитель принять свою работу
  // не может — иначе приёмка перестала бы что-либо значить.
  const isOwner = task.user_id === user.id;
  const isAuthor = task.created_by === user.id;
  if (!isOwner && !isAuthor) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });

  const now = new Date().toISOString();
  const comment = (body.comment || "").trim();

  if (body.action === "return" && !comment) {
    return NextResponse.json({ error: "Напишите, что доделать" }, { status: 400 });
  }
  if (body.action === "force" && !comment) {
    return NextResponse.json({ error: "Нужна причина" }, { status: 400 });
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
    const target = person ? chatsFor(person as ColleagueRow)[0] : undefined;
    if (target) {
      await sendToColleague(
        target,
        moved
          ? `📅 Срок перенесён: «${task.title}»${when ? "\nНовый срок: " + fmtDate(when) : ""}${comment ? "\n\n" + comment : ""}`
          : `📅 Срок остаётся прежним: «${task.title}»${comment ? "\n\n" + comment : ""}`,
        taskButtons(task.id, "executor"),
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Принято и закрыто — одно и то же событие. «Принял, но задача висит
  // открытой» не значит ничего: ни для списка, ни для сводки, ни для
  // человека, который отчитался.
  const closed = { status: "done", completed_at: now, last_completed_on: now.slice(0, 10) };

  if (body.action === "approve") {
    await admin
      .from("tasks")
      .update({ approval_state: "accepted", approval_comment: comment || null, approved_at: now, ...closed })
      .eq("id", task.id);
  } else if (body.action === "return") {
    await admin.from("tasks").update({ approval_state: "returned", approval_comment: comment, approved_at: null }).eq("id", task.id);
    // Отчёты исполнителей обнуляются: иначе задача осталась бы в состоянии
    // «отчитались все» и приёмка предложилась бы снова, ничего не изменив.
    await admin.from("task_participants").update({ done_at: null, done_comment: null }).eq("task_id", task.id).eq("role", "executor");
  } else {
    await admin
      .from("tasks")
      .update({ approval_state: "accepted", approved_at: now, force_closed_by: user.id, force_closed_reason: comment, ...closed })
      .eq("id", task.id);
  }

  // Хроника пишется до рассылки: сообщение может не уйти (нет чата, нет
  // связи), а запись о решении остаться должна в любом случае — именно её
  // потом и ищут, когда спрашивают «а что просили доделать».
  const byWhom = isOwner ? "Владелец" : "Постановщик";
  await recordEvent(admin, {
    userId: task.user_id,
    kind: "task",
    itemId: task.id,
    text:
      body.action === "return"
        ? `↩ ${byWhom} вернул на доработку: ${comment}`
        : body.action === "approve"
          ? `✅ ${byWhom} принял работу${comment ? ": " + comment : ""}`
          : `🔒 ${byWhom} закрыл задачу волевым решением: ${comment}`,
  });

  // Сказать людям. Молчание после возврата на доработку — самый дорогой
  // вид молчания здесь: работа стоит, и никто не знает, что она стоит.
  const { data: parts } = await admin
    .from("task_participants")
    .select("assignee_id, role")
    .eq("task_id", task.id)
    .in("role", ["executor", "coexecutor"]);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (ids.length) {
    const { data: people } = await admin
      .from("assignees")
      .select("id, name, telegram_chat_id, max_user_id")
      .in("id", ids);

    const text =
      body.action === "return"
        ? `↩ Вернули на доработку: «${task.title}»\n\n${comment}`
        : body.action === "approve"
          ? `✅ Принято: «${task.title}»${comment ? "\n\n" + comment : ""}`
          : `🔒 Задача закрыта: «${task.title}»\n\n${comment}`;

    // Под возвратом — кнопки, которыми на него отвечают.
    //
    // Раньше приходил голый текст, а сообщение с кнопками, которым задачу
    // присылали, к этому моменту уже переписано в «🏁 Отмечено
    // выполненным» — то есть отчитаться заново было буквально нечем, кроме
    // как листать переписку назад. Правило шире этого места: каждое
    // сообщение бота, после которого от человека чего-то ждут, обязано
    // нести кнопку этого действия. После приёмки и закрытия ждать нечего —
    // там остаётся только «Ответить», чтобы сказать спасибо или возразить.
    const buttons = body.action === "return" ? taskButtons(task.id, "executor") : replyButtons("task", task.id);

    for (const person of ((people || []) as ColleagueRow[])) {
      const target = chatsFor(person)[0];
      if (target) await sendToColleague(target, text, buttons);
    }
  }

  return NextResponse.json({ ok: true });
}
