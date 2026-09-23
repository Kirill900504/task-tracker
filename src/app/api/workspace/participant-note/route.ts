import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readInput, participantNoteInput } from "@/lib/apiInput";
import { recordEvent } from "@/lib/itemHistory";
import { isSelfAssignee } from "@/lib/trackerRows";
import { withoutSelfMark } from "@/lib/actorName";

// Кто на задаче поменялся — строка в хронику, той же формы, что у приёмки,
// отчёта и переноса. Слова Кирилла 23.09.2026: «добавь в историю чата
// добавление или исключение в исполнители, наблюдатели или соисполнители
// людей» — до этого состав менялся молча, и через неделю никто не мог
// сказать, когда и кем Аню сняли с задачи.
//
// Почему отдельным маршрутом, а не прямо из браузера (как сама вставка в
// task_participants, которая браузеру разрешена RLS): системную строку
// (`system: true`) не может вставить никто, кроме служебного ключа
// (миграция 0026, «Пишет только маршрут, служебным ключом») — и это
// правильно, иначе кто угодно подделал бы хронику собственной задачи.
// Текст при этом собирает сам маршрут по проверенным именам, а не
// принимает готовую строку от браузера: присланный текст было бы легко
// подменить на что угодно.

const ROLE_LABEL: Record<string, string> = {
  executor: "исполнитель",
  coexecutor: "соисполнитель",
  watcher: "наблюдатель",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, participantNoteInput);
  if (badInput) return badInput;

  const admin = createAdminClient();

  // Та же граница, что у RLS-политик task_participants_owner_write и
  // task_participants_author_write (миграции 0019/0031): своё пространство
  // или своя же задача. Здесь она проверяется руками, потому что пишет
  // строку админ-клиент, который эти политики не видит вовсе.
  const { data: task } = await admin.from("tasks").select("id, title, user_id, created_by").eq("id", body.taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  const allowed = task.user_id === user.id || task.created_by === user.id;
  if (!allowed) return NextResponse.json({ error: "Нет прав менять состав этой задачи" }, { status: 403 });

  type NameRow = { name: string } | { name: string }[] | null;
  const nameFrom = (a: NameRow) => (Array.isArray(a) ? a[0]?.name : a?.name) || "";

  const { data: member } = await admin
    .from("workspace_members")
    .select("assignees(name)")
    .eq("member_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  let actorName = withoutSelfMark(nameFrom((member as { assignees: NameRow } | null)?.assignees ?? null));
  if (!actorName) {
    const { data: mine } = await admin.from("assignees").select("name").eq("user_id", user.id);
    const self = (mine || []).find((r) => isSelfAssignee((r.name as string) || ""));
    actorName = withoutSelfMark((self?.name as string) || "");
  }
  actorName = actorName || "Участник";

  const { data: targetRow } = await admin.from("assignees").select("name").eq("id", body.assigneeId).maybeSingle();
  const targetName = withoutSelfMark((targetRow?.name as string) || "") || "человек";
  const roleLabel = body.role ? ROLE_LABEL[body.role] || body.role : "";

  const text =
    body.action === "add"
      ? `➕ ${actorName} добавил на задачу: ${targetName} — ${roleLabel}`
      : body.action === "remove"
        ? `➖ ${actorName} убрал с задачи: ${targetName}`
        : `🔄 ${actorName} назначил: ${targetName} — ${roleLabel}`;

  await recordEvent(admin, { userId: task.user_id, kind: "task", itemId: task.id, text });
  return NextResponse.json({ ok: true });
}
