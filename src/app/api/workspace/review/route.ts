import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";

// Решение постановщика по отчёту: принять, вернуть, закрыть волевым.
//
// Зеркало /api/workspace/report. Тот маршрут доносит ответ исполнителя до
// владельца; этот — решение владельца до исполнителей. Без него возврат на
// доработку узнавался только из утренней сводки: задача, которую ждут
// сегодня, лежала бы до завтра просто потому, что человеку не сказали.
//
// Состояние приёмки пишется здесь, а `status` задачи — нет: им владеет
// движок синхронизации в браузере, и запись мимо него откатится первой же
// открытой вкладкой (см. taskToRow).

type Body = {
  action: "approve" | "return" | "force";
  taskId: string;
  comment?: string;
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

  if (body.action === "approve") {
    await admin.from("tasks").update({ approval_state: "accepted", approval_comment: comment || null, approved_at: now }).eq("id", task.id);
  } else if (body.action === "return") {
    await admin.from("tasks").update({ approval_state: "returned", approval_comment: comment, approved_at: null }).eq("id", task.id);
    // Отчёты исполнителей обнуляются: иначе задача осталась бы в состоянии
    // «отчитались все» и приёмка предложилась бы снова, ничего не изменив.
    await admin.from("task_participants").update({ done_at: null, done_comment: null }).eq("task_id", task.id).eq("role", "executor");
  } else {
    await admin
      .from("tasks")
      .update({ approval_state: "accepted", approved_at: now, force_closed_by: user.id, force_closed_reason: comment })
      .eq("id", task.id);
  }

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

    for (const person of ((people || []) as ColleagueRow[])) {
      const target = chatsFor(person)[0];
      if (target) await sendToColleague(target, text);
    }
  }

  return NextResponse.json({ ok: true });
}
