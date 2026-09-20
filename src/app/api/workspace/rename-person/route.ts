import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readInput, renamePersonInput } from "@/lib/apiInput";
import { isSelfAssignee } from "@/lib/trackerRows";

// Переименовать человека — сразу везде, где написано его имя.
//
// Имя живёт в двух видах, и это осознанная пара: строка в `assignees` —
// это ЧЕЛОВЕК (по её id держатся участие, голоса, привязка к разделам и
// чат мессенджера), а `tasks.assignee` и `meetings.participants` — это
// ИМЯ, которое видно на карточке и уходит в сообщение бота. Пока они
// совпадают буква в букву, по имени находят человека: так работает
// триггер миграции 0024, так ищет assignExecutors, так считают сводки.
//
// Отсюда всё устройство этого маршрута. Переименовать строку и забыть про
// задачи значит развести имя и человека: карточка останется подписана
// прежним именем, и трекер перестанет узнавать в ней настоящего человека —
// ровно та «вторая правда об одном факте», ради которой писался аудит
// 15.09.2026. Поэтому три записи идут вместе, и делает их сервер: из
// браузера чужую задачу не переписать (и правильно).
//
// Почему это вообще понадобилось: переименовать человека было нельзя
// ниоткуда. Опечатка в имени, «Юра» вместо «Юрий», фамилия, которой не
// хватает, — всё это оставалось навсегда, а имя видят четырнадцать человек
// и по нему же выбирают, кому поручить.
//
// Право на это у владельца: список людей общий на всё пространство, и
// заведённый кем угодно человек появляется у всех (см. «Справочники —
// админские» в CLAUDE.md). Своё имя владелец меняет так же — его строка
// помечена «(я)», и пометка остаётся на месте: по ней трекер понимает,
// какая строка его собственная.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, renamePersonInput);
  if (badInput) return badInput;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("assignees")
    .select("id, user_id, name")
    .eq("id", body.assigneeId)
    .maybeSingle();
  const person = row as { id: string; user_id: string; name: string } | null;
  if (!person) return NextResponse.json({ error: "Человек не найден" }, { status: 404 });

  // Владелец пространства — и только он: имя человека видят все, кто в
  // этом пространстве работает.
  if (person.user_id !== user.id) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });

  // Пометка «(я)» — часть имени строки владельца, а не украшение: по ней
  // его собственная строка находится в списке людей (isSelfAssignee), и
  // без неё перестанут работать и «Сделал» по задаче, поставленной ему, и
  // правило «себе не пишут». Поэтому она не снимается и не приписывается
  // руками — маршрут сохраняет её ровно там, где она была.
  const wasSelf = isSelfAssignee(person.name);
  const clean = body.name.replace(/\s*\(я\)\s*$/i, "").trim();
  if (!clean) return NextResponse.json({ error: "Имя не может быть пустым" }, { status: 400 });
  const name = wasSelf ? `${clean} (я)` : clean;
  if (name === person.name) return NextResponse.json({ ok: true, name });

  const { data: taken } = await admin
    .from("assignees")
    .select("id")
    .eq("user_id", person.user_id)
    .eq("name", name)
    .maybeSingle();
  if (taken) return NextResponse.json({ error: `В списке уже есть «${name}»` }, { status: 400 });

  const { error: nameError } = await admin.from("assignees").update({ name }).eq("id", person.id);
  if (nameError) return NextResponse.json({ error: nameError.message }, { status: 500 });

  // Дальше — имя, написанное на карточках. Если этот шаг не пройдёт,
  // задачи останутся подписаны прежним именем: строка человека уже
  // переименована, и «назначено только на словах» поймает это в
  // понедельничной сводке (assignmentDrift). Молчать об этом нельзя,
  // поэтому ответ честно говорит, что переименовано не всё.
  const { error: taskError } = await admin
    .from("tasks")
    .update({ assignee: name })
    .eq("user_id", person.user_id)
    .eq("assignee", person.name);

  // Состав встречи — массив строк, и заменить в нём одно значение может
  // только сама база. PostgREST этого не умеет, поэтому строки читаются и
  // переписываются по одной: встреч с одним человеком единицы.
  const { data: meetings } = await admin
    .from("meetings")
    .select("id, participants")
    .eq("user_id", person.user_id)
    .contains("participants", [person.name]);
  let meetingError = "";
  for (const m of ((meetings || []) as { id: string; participants: string[] }[])) {
    const next = (m.participants || []).map((p) => (p === person.name ? name : p));
    const { error } = await admin.from("meetings").update({ participants: next }).eq("id", m.id);
    if (error) meetingError = error.message;
  }

  return NextResponse.json({
    ok: true,
    name,
    // Что не доехало — говорится вслух: имя на карточке, разошедшееся с
    // человеком, иначе обнаруживается неделей позже вопросом «почему он
    // ничего не делает».
    warning: taskError?.message || meetingError || undefined,
  });
}
