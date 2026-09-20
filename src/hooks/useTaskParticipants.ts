"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { assignPerson, waitForTaskRow } from "@/lib/assignWork";
import type { TaskParticipant, TaskParticipantRole } from "@/lib/taskProgress";

// Кто на задаче: исполнители, соисполнители, наблюдатели.
//
// Deliberately NOT part of useTrackerData. That hook is an optimistic
// diff-and-sync engine: local state is the truth while you type, and a
// deep-cloned "shadow" of what the database confirmed is what the diff runs
// against. Threading a second, differently-shaped table through it is how
// that machinery breaks — and it broke once already, expensively (see the
// sync rule in CLAUDE.md).
//
// Participation does not need any of that. It changes by pressing a button,
// not by typing; there is nothing to debounce and nothing to merge. So it is
// written straight through and read back, with realtime keeping the screen
// honest when somebody answers from Telegram.

export type Participant = TaskParticipant & {
  id: string;
  // Просьба о переносе: исполнитель может только попросить (B6), и до сих
  // пор просьба уходила в базу и не показывалась никому — то есть
  // человек просил в пустоту.
  rescheduleTo: string | null;
  rescheduleReason: string | null;
};

type Row = {
  id: string;
  task_id: string;
  assignee_id: string;
  role: TaskParticipantRole;
  accepted_at: string | null;
  done_at: string | null;
  done_comment: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  reschedule_requested_at: string | null;
  reschedule_to: string | null;
  reschedule_reason: string | null;
  assignees: Person | Person[] | null;
};

type Person = { name: string; telegram_chat_id: number | null; max_user_id: number | null };

function personOf(row: Row): Person | null {
  const a = row.assignees;
  if (!a) return null;
  return Array.isArray(a) ? a[0] || null : a;
}

function nameOf(row: Row): string {
  return personOf(row)?.name || "";
}

// Есть ли у человека куда получить задачу. Вход в трекер сюда не считается
// намеренно: строка на карточке отвечает на вопрос «ушло ли сообщение», а
// не «увидит ли он когда-нибудь».
function reachableOf(row: Row): boolean {
  const p = personOf(row);
  return !!p && (p.telegram_chat_id != null || p.max_user_id != null);
}

export type PersonOption = { id: string; name: string };

// Кого поставили на задачу ДО того, как она появилась в базе: выбор,
// сделанный в окне создания и ждущий своей строки (см. attachOnCreate).
export type PendingParticipant = { assigneeId: string; name: string; role: TaskParticipantRole };

export function useTaskParticipants() {
  const [byTask, setByTask] = useState<Record<string, Participant[]>>({});
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetching and applying are split on purpose: the React compiler lint
  // refuses a function that sets state being called straight from an effect
  // body, and it is right to — the state has to land in the promise
  // callback, where the "was this unmounted" guard lives. Same shape as
  // useColleagues, for the same reason.
  const fetchAll = useCallback(async (): Promise<{ grouped: Record<string, Participant[]>; people: PersonOption[] }> => {
    const db = createClient();
    const [{ data: rows }, { data: assignees }] = await Promise.all([
      db
        .from("task_participants")
        .select(
          "id, task_id, assignee_id, role, accepted_at, done_at, done_comment, declined_at, decline_reason, reschedule_requested_at, reschedule_to, reschedule_reason, assignees(name, telegram_chat_id, max_user_id)",
        ),
      // The full list, the owner's own row included: work can be put on
      // yourself, and the send menu is the only place that has a reason to
      // leave you out of it.
      db.from("assignees").select("id, name").order("name"),
    ]);

    const grouped: Record<string, Participant[]> = {};
    for (const raw of (rows || []) as Row[]) {
      const p: Participant = {
        id: raw.id,
        assigneeId: raw.assignee_id,
        name: nameOf(raw),
        role: raw.role,
        acceptedAt: raw.accepted_at,
        doneAt: raw.done_at,
        doneComment: raw.done_comment,
        declinedAt: raw.declined_at,
        declineReason: raw.decline_reason,
        // «Не подключён» видно всегда, а не только в секунду добавления:
        // четверо из шести людей в боевом трекере не подключены, и задача
        // до них не доходит молча.
        reachable: reachableOf(raw),
        rescheduleTo: raw.reschedule_to,
        rescheduleReason: raw.reschedule_reason,
      };
      (grouped[raw.task_id] ||= []).push(p);
    }
    return {
      grouped,
      // Порядок — тот, который назвал Кирилл, а не алфавитный: списки людей
      // во всём трекере должны читаться одинаково (см. peopleOrder.ts).
      people: sortByPeopleOrder(((assignees || []) as PersonOption[]).map((a) => ({ id: a.id, name: a.name })), (p) => p.name),
    };
  }, []);

  const load = useCallback(async () => {
    const { grouped, people: list } = await fetchAll();
    setByTask(grouped);
    setPeople(list);
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(({ grouped, people: list }) => {
      if (cancelled) return;
      setByTask(grouped);
      setPeople(list);
      setLoading(false);
    });

    // Somebody pressing «Сделал» in Telegram has to move the card here
    // without a reload — the same reason every other table the UI watches is
    // in the realtime publication.
    const db = createClient();
    const channel = db
      // Имя канала уникально на каждый вызов хука, и это не украшение.
      // Supabase отказывается добавлять подписку к каналу, который уже
      // подписан, — и отказывается ИСКЛЮЧЕНИЕМ: «cannot add
      // postgres_changes callbacks after subscribe()». Брошенное из
      // эффекта, оно кладёт весь экран, а не только второе окно. Ровно так
      // 19.09.2026 падал трекер, стоило открыть окно, которое позвало этот
      // хук вторым.
      //
      // Два канала — не идеал (два потока об одном и том же), и хук
      // по-прежнему стоит держать в одном месте на панель. Но разница
      // между «лишняя подписка» и «белый экран» такая, что выбор
      // очевиден.
      .channel("task-participants:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_participants" }, () => {
        fetchAll().then(({ grouped, people: list }) => {
          if (cancelled) return;
          setByTask(grouped);
          setPeople(list);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [fetchAll]);

  const add = useCallback(
    async (taskId: string, assigneeId: string, role: TaskParticipantRole): Promise<string> => {
      const person = people.find((p) => p.id === assigneeId);
      const notice = await assignPerson(taskId, assigneeId, person?.name || "", role);
      await load();
      return notice;
    },
    [load, people],
  );

  // Всё, что выбрали в окне создания, — одной операцией, когда задача
  // доехала до базы.
  //
  // Поле «Исполнитель» и список участников — не два разных механизма, а
  // короткая и полная запись одного и того же. Поэтому сохранение задачи с
  // исполнителем заводит ему строку само: иначе человек, привыкший к полю,
  // получил бы задачу без единого участника и без единого отчёта, а список
  // выглядел бы необязательной добавкой, которую можно не заполнять.
  const attachOnCreate = useCallback(
    async (taskId: string, assigneeName: string, extra: PendingParticipant[] = []) => {
      const wanted: { id: string; role: TaskParticipantRole }[] = [];

      const clean = (assigneeName || "").trim();
      if (clean && !isSelfAssignee(clean)) {
        const primary = people.find((p) => p.name === clean);
        if (primary) wanted.push({ id: primary.id, role: "executor" });
      }
      for (const person of extra) {
        if (!wanted.some((w) => w.id === person.assigneeId)) wanted.push({ id: person.assigneeId, role: person.role });
      }

      const already = new Set((byTask[taskId] || []).map((p) => p.assigneeId));
      const todo = wanted.filter((w) => !already.has(w.id));
      if (!todo.length) return [];

      // Не дождались (нет связи, задача не ушла в облако) — молча выходим:
      // участников можно добавить руками, а падать здесь незачем.
      if (!(await waitForTaskRow(taskId))) return [];

      // По одному, а не пачкой: каждая вставка ещё и пишет человеку в
      // мессенджер, и «назначена» — то, о чём узнают порознь.
      //
      // И то, что она сказала, возвращается наверх. Раньше здесь стояло
      // `await add(...)` без присваивания, и «Никита не подключён — задача
      // до него не дошла» терялось ровно на самом частом пути: поставить
      // задачу, вписав имя в поле. Список участников это сообщение
      // показывал, а сохранение карточки — нет.
      const notices: string[] = [];
      for (const w of todo) {
        const said = await add(taskId, w.id, w.role);
        if (said) notices.push(said);
      }
      return notices;
    },
    [people, byTask, add],
  );

  // Роль, снятая просьба о переносе и удаление участника меняются на экране
  // сразу, а перечитывается таблица только если запись не прошла. Раньше
  // каждое из трёх нажатий тянуло ВСЕ строки участия по всем задачам разом —
  // и до ответа на это карточка показывала прежнее состояние, то есть ровно
  // то, что выглядит как «кнопка не сработала».
  const patchParticipant = useCallback((participantId: string, change: (p: Participant) => Participant) => {
    setByTask((prev) => {
      const next: Record<string, Participant[]> = {};
      for (const [taskId, list] of Object.entries(prev)) {
        next[taskId] = list.map((p) => (p.id === participantId ? change(p) : p));
      }
      return next;
    });
  }, []);

  const setRole = useCallback(
    async (participantId: string, role: TaskParticipantRole) => {
      patchParticipant(participantId, (p) => ({ ...p, role }));
      const db = createClient();
      const { error } = await db.from("task_participants").update({ role }).eq("id", participantId);
      if (error) await load();
    },
    [load, patchParticipant],
  );

  // Просьбу либо удовлетворяют, либо отклоняют — в обоих случаях она
  // перестаёт висеть. Сам срок меняет вызывающий: колонка deadline
  // принадлежит движку синхронизации, и писать её отсюда нельзя.
  //
  // А вот закрытие просьбы идёт через маршрут, а не строкой в базу, и по
  // той же причине, по которой через маршрут идут приёмка и возврат: решение
  // ждёт человек. Раньше вкладка просто стирала строку, и для попросившего
  // «срок двинули», «отказали» и «не заметили» выглядели одинаково — то есть
  // никак.
  const decideReschedule = useCallback(
    async (taskId: string, participantId: string, moved: boolean, date?: string | null) => {
      patchParticipant(participantId, (p) => ({ ...p, rescheduleTo: null, rescheduleReason: null }));
      const res = await fetch("/api/workspace/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: moved ? "moved" : "kept", taskId, participantId, date: date ?? null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) {
        await load();
        throw new Error(data?.error || "Не получилось ответить на просьбу");
      }
      await load();
    },
    [load, patchParticipant],
  );

  const remove = useCallback(
    async (participantId: string) => {
      setByTask((prev) => {
        const next: Record<string, Participant[]> = {};
        for (const [taskId, list] of Object.entries(prev)) next[taskId] = list.filter((p) => p.id !== participantId);
        return next;
      });
      const db = createClient();
      const { error } = await db.from("task_participants").delete().eq("id", participantId);
      if (error) await load();
    },
    [load],
  );

  // Только что заведённый человек должен появиться кнопкой сразу.
  //
  // Список людей здесь читается из таблицы напрямую, а заводит человека
  // движок синхронизации — своим чередом и своей очередью. Пока строка не
  // доехала, её id неизвестен, а без id человека нельзя поставить на задачу:
  // раньше это скрывалось тем, что «Исполнитель» был просто именем в
  // выпадающем списке. Поэтому — подождать строку и перечитать список; то
  // же самое и по той же причине делает waitForTaskRow в assignWork.ts.
  const waitForPerson = useCallback(
    async (name: string) => {
      const clean = (name || "").trim();
      if (!clean) return;
      const db = createClient();
      for (let i = 0; i < 12; i++) {
        const { data } = await db.from("assignees").select("id").eq("name", clean).maybeSingle();
        if (data) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await load();
    },
    [load],
  );

  // ---- Приёмка ------------------------------------------------------
  //
  // These write ONLY columns the sync engine does not own (see taskToRow:
  // it lists the columns it writes, and none of these are in it). Marking
  // the task done is not done here for exactly that reason — `status` IS a
  // synced column, and writing it behind the local state's back is how an
  // open tab silently reverts it. The caller flips the status through the
  // ordinary path and passes nothing back.

  // Решение постановщика уходит на сервер по той же причине, по которой
  // туда ушли ответы исполнителя: правила должны жить в одном месте, и
  // сказать людям о возврате может только тот, у кого есть доступ к боту.
  const review = useCallback(
    async (action: "approve" | "return" | "force" | "reopen", taskId: string, comment: string) => {
      const res = await fetch("/api/workspace/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, taskId, comment }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || "Не получилось");
      await load();
    },
    [load],
  );

  // ---- Ответ исполнителя --------------------------------------------
  //
  // «Принял», «Сделал», «Не могу», «Прошу перенос» — то, что раньше жило на
  // отдельном экране «Что от вас ждут». Экрана больше нет: отвечают там же,
  // где задачу читают, — в её карточке. Слова Кирилла 19.09.2026 об этом
  // экране: «супер не удобный для использования… у всех пользователей окно
  // должно сразу быть как у меня».
  //
  // Маршрут тот же самый, что и у кнопок в мессенджере. Это не экономия
  // кода: обязательный комментарий, обязательная причина, переход на
  // приёмку и сообщение постановщику — правила, и вторая их копия разошлась
  // бы с первой (так уже было, см. комментарий в самом маршруте).
  const answer = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/workspace/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) {
        await load();
        throw new Error(data?.error || "Не получилось отправить ответ");
      }
      await load();
    },
    [load],
  );

  const acceptWork = useCallback((participantId: string) => answer({ action: "accept", participantId }), [answer]);
  const reportWork = useCallback(
    (participantId: string, comment: string) => answer({ action: "done", participantId, comment }),
    [answer],
  );
  const declineWork = useCallback(
    (participantId: string, reason: string) => answer({ action: "decline", participantId, comment: reason }),
    [answer],
  );
  const askReschedule = useCallback(
    (participantId: string, to: string, reason: string) =>
      answer({ action: "reschedule", participantId, date: to || null, comment: reason }),
    [answer],
  );

  const approve = useCallback((taskId: string, comment: string) => review("approve", taskId, comment), [review]);
  const returnForRework = useCallback((taskId: string, comment: string) => review("return", taskId, comment), [review]);
  const forceClose = useCallback((taskId: string, reason: string) => review("force", taskId, reason), [review]);
  // Приёмку снимает только сервер: колонка не принадлежит движку
  // синхронизации, и снятая в браузере галочка «сделано» оставляла задачу
  // в «Завершённых» навсегда.
  const reopen = useCallback((taskId: string, comment: string) => review("reopen", taskId, comment), [review]);

  const forTask = useCallback((taskId: string) => byTask[taskId] || [], [byTask]);

  // Only the people not already on the task — offering to add somebody
  // twice produces a constraint error rather than a second row.
  const availableFor = useCallback(
    (taskId: string) => {
      const taken = new Set((byTask[taskId] || []).map((p) => p.assigneeId));
      return people.filter((p) => !taken.has(p.id));
    },
    [byTask, people],
  );

  return useMemo(
    () => ({
      loading,
      people,
      forTask,
      availableFor,
      add,
      attachOnCreate,
      setRole,
      remove,
      waitForPerson,
      decideReschedule,
      approve,
      returnForRework,
      forceClose,
      reopen,
      acceptWork,
      reportWork,
      declineWork,
      askReschedule,
      reload: load,
    }),
    [
      loading,
      people,
      forTask,
      availableFor,
      add,
      attachOnCreate,
      setRole,
      remove,
      waitForPerson,
      decideReschedule,
      approve,
      returnForRework,
      forceClose,
      reopen,
      acceptWork,
      reportWork,
      declineWork,
      askReschedule,
      load,
    ],
  );
}
