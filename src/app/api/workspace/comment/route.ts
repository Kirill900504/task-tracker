import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { commentInput, readInput } from "@/lib/apiInput";
import { deliverComment } from "@/lib/commentDelivery";

// Сказать остальным, что в обсуждении появилось сообщение.
//
// Почему не вставка целиком, как в /api/workspace/report. Вставку делает
// браузер, и это осознанно: вместе с текстом уезжают файлы, которые он
// кладёт прямо в корзину, и задача, ещё не доехавшая до облака, требует
// подождать её и повторить (см. useItemComments). Тащить всё это через
// сервер значит гонять фотографии дважды и переписать самый выверенный
// кусок обсуждения ради единообразия.
//
// А вот «кому сказать» — правило, и оно, как все правила здесь, живёт в
// одном месте (commentDelivery). Этот маршрут только проверяет, что
// сообщение и вправду ваше, и зовёт его.
//
// Если вызов не дойдёт — сообщение всё равно записано, и о нём скажет
// утренняя сводка: «💬 писали в обсуждениях». Петля замыкается медленнее,
// но не рвётся.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, commentInput);
  if (badInput) return badInput;

  const admin = createAdminClient();
  // Автор берётся из базы, а не из запроса: иначе достаточно прислать чужой
  // id, чтобы разослать чужое сообщение от его имени.
  const { data } = await admin
    .from("item_comments")
    .select("id, author_user_id")
    .eq("id", body.commentId)
    .maybeSingle();
  const comment = data as { id: string; author_user_id: string | null } | null;
  if (!comment) return NextResponse.json({ error: "Сообщение не найдено" }, { status: 404 });
  if (comment.author_user_id !== user.id) return NextResponse.json({ error: "Это не ваше сообщение" }, { status: 403 });

  const result = await deliverComment(admin, comment.id);
  return NextResponse.json({ ok: true, ...result });
}
