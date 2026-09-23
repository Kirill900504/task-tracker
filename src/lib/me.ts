"use client";

import { createClient } from "@/lib/supabase/client";

// Кто пишет — вопрос, который задают на каждое действие, и ответ на него
// не меняется.
//
// Стоит он дороже, чем кажется. `auth.getUser()` — это ЗАПРОС В СЕТЬ: он
// каждый раз спрашивает сервер, жив ли токен. Отправка сообщения в
// обсуждении задавала его дважды (один раз при вставке, второй — при
// перечитывании ленты) и следом спрашивала таблицу участников, кто я в ней.
// Три обращения к облаку до того, как на экране появится хоть что-то, — это
// и есть та самая «секундная задержка»: набрали, нажали, ждём.
//
// Поэтому ответ берётся из сессии, которая и так лежит в браузере
// (`getSession` в сеть не ходит), и запоминается на всю вкладку. Это не
// вопрос доверия: подставить чужой id всё равно нельзя — права в базе
// сверяют пишущего с настоящим `auth.uid()`, а не с тем, что прислал
// браузер. Здесь ответ нужен, чтобы показать «Вы» и подписать строку.

export type Me = {
  userId: string;
  // Строка в списке людей: у вошедшего в трекер есть и логин, и имя в
  // списке, и подписать сообщение нужно именем.
  assigneeId: string | null;
  // Чьё это пространство. Первый сегмент пути к файлу — по нему права и
  // решают, чей это файл (миграция 0020). У владельца это он сам, у
  // руководителя — тот, кто его позвал.
  workspaceId: string;
};

let cached: Promise<Me> | null = null;
let watching = false;

function forget() {
  cached = null;
}

// Смена входа — не единственное, что делает ответ неверным.
//
// 23.09.2026: Игорь Витковский написал в обсуждение и получил «new row
// violates row-level security policy for table item_comments». Причина не в
// правах — его членство было настоящим, — а в том, что оно появилось ПОСЛЕ
// того, как эта вкладка уже спросила и запомнила ответ: строка
// workspace_members ещё не существовала (или он не был активен), кэш
// зафиксировал `assigneeId: null`, и с этой минуты каждая отправка слала
// `author_assignee_id: null`, а база сверяет его с настоящим значением —
// несовпадение и есть отказ RLS. Auth здесь ни при чём: сессия та же, что
// была, событие входа не срабатывает.
// Поэтому кэш забывается и при изменении самого членства — тем же приёмом,
// каким `sharedStore` считает устаревшим список команды по этой же таблице.
function watchAuth() {
  if (watching) return;
  watching = true;
  const db = createClient();
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") forget();
  });
  db.channel("me-membership")
    .on("postgres_changes", { event: "*", schema: "public", table: "workspace_members" }, () => forget())
    .subscribe();
}

async function load(): Promise<Me> {
  const db = createClient();
  const { data } = await db.auth.getSession();
  const userId = data.session?.user?.id || "";
  if (!userId) return { userId: "", assigneeId: null, workspaceId: "" };

  const { data: member } = await db
    .from("workspace_members")
    .select("assignee_id, owner_id")
    .eq("member_id", userId)
    .maybeSingle();
  const row = member as { assignee_id?: string | null; owner_id?: string | null } | null;
  return { userId, assigneeId: row?.assignee_id ?? null, workspaceId: row?.owner_id || userId };
}

export function me(): Promise<Me> {
  watchAuth();
  if (!cached) {
    cached = load().then((result) => {
      // Пустой ответ не запоминаем: он означает «сессия ещё не дочиталась»,
      // а не «человека нет», и залипнуть на нём значит показывать чужими
      // все собственные сообщения до перезагрузки страницы.
      if (!result.userId) forget();
      return result;
    });
    // Неудачу тоже не запоминаем — следующий вызов попробует заново.
    cached.catch(forget);
  }
  return cached;
}
