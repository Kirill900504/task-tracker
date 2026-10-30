"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { coalescer } from "@/lib/coalesce";
import { answerPatch, type AnswerPayload } from "@/lib/answerPatch";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { onRevive } from "@/lib/revive";
import { playCloseSound } from "@/lib/closeSound";
import { assignPerson, waitForTaskRow } from "@/lib/assignWork";
import type { Attachment } from "@/hooks/useItemComments";
import { uploadResultFiles } from "@/lib/resultFiles";
import { postInBackground, postJson } from "@/lib/postJson";
import type { TaskParticipant, TaskParticipantRole } from "@/lib/taskProgress";
import { OUTBOX_SENT_EVENT, pendingPosts } from "@/lib/outbox";

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
  done_files: Attachment[] | null;
  declined_at: string | null;
  decline_reason: string | null;
  reschedule_requested_at: string | null;
  reschedule_to: string | null;
  reschedule_reason: string | null;
  seen_at: string | null;
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


// Кто на задачах — с прошлого запуска, чтобы доска не перекладывалась на
// глазах.
//
// Столбец задачи выводится из строк участия (см. lib/kanban), а они
// приезжают отдельным запросом — на полсекунды позже самих задач. Всё это
// время доска показывает ПРАВДОПОДОБНУЮ НЕПРАВДУ: всё лежит в «Новых», а
// потом, через секунду, карточки прыгают по местам. Замер 20.09.2026:
// доска готова за 274 мс, а на своём месте карточка оказывается через
// 1100. Кирилл это и назвал задержкой в работе трекера.
//
// Поэтому ответ прошлого запуска лежит рядом, под ключом своего auth-id
// (его пишет useWorkspaceRole), и отдаётся первым кадром. Свежий приходит
// следом и заменяет его — как и везде в трекере: сначала известное,
// потом точное.
const CACHE_KEY = "kkt_participants";

type Cached = { userId: string; grouped: Record<string, Participant[]>; people: PersonOption[] };

function myUserId(): string {
  try {
    const raw = localStorage.getItem("kkt_identity");
    return raw ? JSON.parse(raw).userId || "" : "";
  } catch {
    return "";
  }
}

function readCache(): Cached | null {
  if (typeof localStorage === "undefined") return null;
  const uid = myUserId();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Cached;
    return saved.userId === uid ? saved : null;
  } catch {
    return null;
  }
}

// Запись — не чаще раза в пару секунд. Сохранять тут есть что (сотня
// килобайт на трекер с сотнями задач), а зовётся это на каждое движение
// в таблице участия: нажал «Принял» один человек — перечитали все.
// Сериализация в такой момент попадает ровно туда, где человек ждёт
// отклика, а потерять последнюю секунду изменений не страшно: они
// приедут сетью на следующем запуске.
let lastWrite = 0;

function writeCache(grouped: Record<string, Participant[]>, people: PersonOption[]) {
  const uid = myUserId();
  if (!uid) return;
  const now = Date.now();
  if (now - lastWrite < 2000) return;
  lastWrite = now;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: uid, grouped, people }));
  } catch {
    /* переполнилось или приватный режим — просто следующий старт будет как раньше */
  }
}

// Ответы, которые ещё в очереди (lib/outbox), — поверх прочитанного из
// базы. Без этого перечитывание (подписка, догон) честно приносило «ещё не
// ответил», и «Сделал», нажатое без связи, исчезало с экрана, хотя оно
// никуда не делось и уйдёт, как только появится сеть. Сеть, которая режет
// только наш сайт, — ровно такой случай: база читается, а маршрут нет.
// Что возврат снимает с ответившего; acceptedAt ставится рядом — см.
// markReturnedAsWorking в lib/reviewWork.
const returnedPatch = { doneAt: null, doneComment: null, doneFiles: [], declinedAt: null, declineReason: null };

function withPending(grouped: Record<string, Participant[]>): Record<string, Participant[]> {
  const queued = [...pendingPosts("/api/workspace/report"), ...pendingPosts("/api/workspace/review")];
  if (!queued.length) return grouped;
  const next: Record<string, Participant[]> = {};
  for (const [taskId, list] of Object.entries(grouped)) next[taskId] = list.map((p) => ({ ...p }));
  const each = (fn: (p: Participant, taskId: string) => void) => {
    for (const [taskId, list] of Object.entries(next)) for (const p of list) fn(p, taskId);
  };
  // По порядку нажатий: очередь уходит так же.
  for (const e of queued.sort((a, b) => a.at - b.at)) {
    const body = e.body;
    // Возвращённый — «В работе» (markReturnedAsWorking на сервере).
    // Сервер трогает только ответивших, и экран тоже: молчавший «Принял»
    // не нажимал, и возврат чужого отчёта его в работу не ставит.
    const clear = (p: Participant) =>
      p.doneAt || p.declinedAt ? { ...returnedPatch, acceptedAt: p.acceptedAt || new Date(e.at).toISOString() } : {};
    if (e.url === "/api/workspace/report") {
      const patch = answerPatch(body as AnswerPayload, new Date(e.at).toISOString());
      if (patch) each((p) => void (p.id === body.participantId && Object.assign(p, patch)));
      continue;
    }
    const action = String(body.action || "");
    const ids = Array.isArray(body.participantIds) ? (body.participantIds as string[]) : null;
    if (action === "return") {
      each((p, taskId) => void (taskId === body.taskId && (ids ? ids.includes(p.id) : p.role === "executor") && Object.assign(p, clear(p))));
    } else if (action === "return_one") {
      each((p) => void (p.id === body.participantId && Object.assign(p, clear(p))));
    } else if (action === "moved" || action === "kept") {
      each((p) => void (p.id === body.participantId && Object.assign(p, { rescheduleTo: null, rescheduleReason: null })));
    }
  }
  return next;
}

export function useTaskParticipants() {
  // Начальное значение — прошлый ответ, если он есть: см. readCache.
  // Читается РОВНО один раз, в ленивом инициализаторе, и это не стиль.
  //
  // Строка `const cached = readCache()` в теле компонента выполняется на
  // каждой перерисовке — то есть разбирает сотню килобайт JSON десятки раз
  // в секунду, пока человек печатает. Экран от этого встаёт намертво:
  // доска не появлялась и за пять секунд, а выглядело это как «трекер не
  // открывается». Поймано своим же e2e через двадцать минут после того,
  // как кэш был написан.
  const [cached] = useState(() => (typeof window === "undefined" ? null : readCache()));
  const [byTask, setByTask] = useState<Record<string, Participant[]>>(() => withPending(cached?.grouped ?? {}));
  const [people, setPeople] = useState<PersonOption[]>(() => cached?.people ?? []);
  const [loading, setLoading] = useState(!cached);
  // Состав, выбранный в окне создания, — на экране сразу, до своих строк.
  //
  // Строки участия появляются только после того, как задача доехала до
  // базы (attachOnCreate ждёт её), а из них выводится всё: вид карточки,
  // «Личная задача», столбец. Первые две секунды новая задача стояла с
  // пустым составом и читалась как поручение — «Кирилл → Кирилл» — и
  // только потом становилась личной (27.10.2026: «сразу должна
  // создаваться личная»). Это заготовки: forTask подмешивает их к
  // настоящим строкам по человеку, и снимаются они, как только
  // attachOnCreate закончил, — иначе снятый позже человек вернулся бы на
  // экран из заготовки.
  const [seeded, setSeeded] = useState<Record<string, Participant[]>>({});

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
          "id, task_id, assignee_id, role, accepted_at, done_at, done_comment, done_files, declined_at, decline_reason, reschedule_requested_at, reschedule_to, reschedule_reason, seen_at, assignees(name, telegram_chat_id, max_user_id)",
        ),
      // The full list, the owner's own row included: work can be put on
      // yourself, and the send menu is the only place that has a reason to
      // leave you out of it.
      // Убранные из команды (миграция 0055) сюда не входят: это список
      // тех, КОГО можно поставить, а имена в участии берутся из самой строки.
      db.from("assignees").select("id, name").is("archived_at", null).order("name"),
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
        // Документы к отчёту (миграция 0039). Ссылок здесь нет: они живут
        // час и запрашиваются тем, кто показывает результат, — см.
        // lib/resultFiles.signResultFiles.
        doneFiles: raw.done_files || [],
        declinedAt: raw.declined_at,
        declineReason: raw.decline_reason,
        // «Не подключён» видно всегда, а не только в секунду добавления:
        // четверо из шести людей в боевом трекере не подключены, и задача
        // до них не доходит молча.
        reachable: reachableOf(raw),
        rescheduleTo: raw.reschedule_to,
        rescheduleReason: raw.reschedule_reason,
        seenAt: raw.seen_at,
      };
      (grouped[raw.task_id] ||= []).push(p);
    }
    return {
      grouped: withPending(grouped),
      // Порядок — тот, который назвал Кирилл, а не алфавитный: списки людей
      // во всём трекере должны читаться одинаково (см. peopleOrder.ts).
      people: sortByPeopleOrder(((assignees || []) as PersonOption[]).map((a) => ({ id: a.id, name: a.name })), (p) => p.name),
    };
  }, []);

  const load = useCallback(async () => {
    const { grouped, people: list } = await fetchAll();
    setByTask(grouped);
    setPeople(list);
    writeCache(grouped, list);
    setLoading(false);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    // Перечитать всё — и по подписке, и по поводам из lib/revive, склеивая
    // всплески (lib/coalesce: за одно открытие участие грузилось трижды).
    const reader = coalescer(async () => {
      const { grouped, people: list } = await fetchAll();
      if (cancelled) return;
      setByTask(grouped);
      setPeople(list);
      writeCache(grouped, list);
      setLoading(false);
    });
    const reload = reader.soon;
    void reader.now();

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
      .on("postgres_changes", { event: "*", schema: "public", table: "task_participants" }, reload)
      // И за самим списком людей — тоже.
      //
      // Этот хук отдаёт форме задачи не только участие, но и то, ИЗ КОГО
      // выбирать, а список людей приезжает в базу отдельно и позже: у
      // нового трекера он подставляется по умолчанию и уходит строками
      // первой же синхронизацией, а у живого пополняется, когда владелец
      // заводит человека в «Команде». Без этой подписки запрос, успевший
      // выполниться раньше вставки, оставлял поле «Кто на задаче» с одной
      // кнопкой «+ человек» — и до перезагрузки страницы поставить задачу
      // было НЕКОМУ. На свежем аккаунте это происходило каждый раз.
      .on("postgres_changes", { event: "*", schema: "public", table: "assignees" }, reload)
      // Каждый подъём канала — повод перечитать: пока он поднимался (или
      // лежал), события просто не приходили, а догонять пропущенное
      // realtime не умеет.
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !reader.startedWithin(2000)) reload();
      });

    // Столбец задачи выводится ИЗ ЭТИХ строк, а не хранится в ней, — то
    // есть подписка, тихо умершая под спящим ноутбуком, оставляет карточку
    // в «Новых» после того, как человек нажал «Принял» в мессенджере.
    // Отсюда тот же догон, что и у самих задач (см. lib/revive.ts).
    const stopRevive = onRevive(reload);
    // Ответ из очереди ушёл (или сервер его отверг) — сверить экран с базой.
    window.addEventListener(OUTBOX_SENT_EVENT, reload);

    return () => {
      cancelled = true;
      reader.stop();
      stopRevive();
      window.removeEventListener(OUTBOX_SENT_EVENT, reload);
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

      // Заготовки — из всего выбранного, включая собственную строку «(я)»:
      // её заводит триггер, а не этот код, но и её ждать нельзя.
      const draft = [...wanted];
      const own = clean && isSelfAssignee(clean) ? people.find((p) => p.name === clean) : undefined;
      if (own && !draft.some((w) => w.id === own.id)) draft.unshift({ id: own.id, role: "executor" });
      if (draft.length) {
        const nameOf = (id: string) => extra.find((p) => p.assigneeId === id)?.name || people.find((p) => p.id === id)?.name || "";
        setSeeded((prev) => ({
          ...prev,
          [taskId]: draft.map((w) => ({
            id: `seed-${taskId}-${w.id}`,
            assigneeId: w.id,
            name: nameOf(w.id),
            role: w.role,
            acceptedAt: null,
            doneAt: null,
            doneComment: null,
            doneFiles: [],
            declinedAt: null,
            declineReason: null,
            rescheduleTo: null,
            rescheduleReason: null,
            seenAt: null,
          })),
        }));
      }
      try {
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
      } finally {
        setSeeded((prev) => {
          if (!(taskId in prev)) return prev;
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
      }
    },
    [people, byTask, add],
  );

  // Заготовка (см. `seeded`) — строка, которой в базе ещё нет, и её id
  // маршрут отвергает («participantId — ожидался идентификатор»). А карточка
  // с заготовкой выглядит готовой: роль, цвет, «Принял в работу» в меню — и
  // нажать его можно в первую же секунду после создания задачи (28.10.2026
  // так падал e2e «Принял» на телефоне, а экран откатывал ответ тостом
  // «Ответ не принят»). Поэтому ответ по заготовке ждёт настоящую строку
  // того же человека на той же задаче и уходит уже с её id.
  const realParticipantId = useCallback(
    async (participantId: string): Promise<string> => {
      if (!participantId.startsWith("seed-")) return participantId;
      let taskId = "";
      let assigneeId = "";
      for (const [t, list] of Object.entries(seeded)) {
        const hit = list.find((p) => p.id === participantId);
        if (hit) {
          taskId = t;
          assigneeId = hit.assigneeId;
          break;
        }
      }
      if (!taskId) return "";
      for (let attempt = 0; attempt < 30; attempt++) {
        const { grouped } = await fetchAll();
        const row = (grouped[taskId] || []).find((p) => p.assigneeId === assigneeId);
        if (row) {
          // Прочитанное — сразу на экран: следом ответ накладывается на ЭТУ
          // строку, а её ещё нет в состоянии.
          setByTask(grouped);
          return row.id;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      return "";
    },
    [seeded, fetchAll],
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
    async (shownId: string, role: TaskParticipantRole) => {
      patchParticipant(shownId, (p) => ({ ...p, role }));
      const participantId = await realParticipantId(shownId);
      if (!participantId) return;
      patchParticipant(participantId, (p) => ({ ...p, role }));
      const db = createClient();
      const { error } = await db.from("task_participants").update({ role }).eq("id", participantId);
      if (error) await load();
    },
    [load, patchParticipant, realParticipantId],
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
      await postJson(
        "/api/workspace/review",
        { action: moved ? "moved" : "kept", taskId, participantId, date: date ?? null },
        { fallback: "Не получилось ответить на просьбу", onFail: load },
      );
      await load();
    },
    [load, patchParticipant],
  );

  const remove = useCallback(
    async (shownId: string) => {
      const participantId = await realParticipantId(shownId);
      setByTask((prev) => {
        const next: Record<string, Participant[]> = {};
        for (const [taskId, list] of Object.entries(prev)) next[taskId] = list.filter((p) => p.id !== participantId);
        return next;
      });
      if (!participantId) return;
      const db = createClient();
      const { error } = await db.from("task_participants").delete().eq("id", participantId);
      if (error) await load();
    },
    [load, realParticipantId],
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
  // Ответ, который возврат снимает, исчезает с экрана сразу — так же, как
  // ответ исполнителя появляется сразу (answerPatch). Отказ сервера
  // перечитывает участие и тем возвращает экран к правде.
  // participantIds — только эти строки (частичный возврат); без них — все
  // исполнители.
  const clearAnswers = useCallback((taskId: string, participantIds?: string | string[]) => {
    const only = participantIds === undefined ? null : Array.isArray(participantIds) ? participantIds : [participantIds];
    setByTask((prev) => {
      const list = prev[taskId];
      if (!list) return prev;
      return {
        ...prev,
        [taskId]: list.map((p) =>
          (only ? only.includes(p.id) && (p.doneAt || p.declinedAt) : p.role === "executor" && (p.doneAt || p.declinedAt))
            ? { ...p, ...returnedPatch, acceptedAt: p.acceptedAt || new Date().toISOString() }
            : p,
        ),
      };
    });
  }, []);

  const review = useCallback(
    async (action: "approve" | "return" | "force" | "reopen" | "wait", taskId: string, comment: string, participantIds?: string[]) => {
      if (action === "return") clearAnswers(taskId, participantIds?.length ? participantIds : undefined);
      await postJson(
        "/api/workspace/review",
        { action, taskId, comment, ...(participantIds?.length ? { participantIds } : {}) },
        { fallback: "Не получилось", onFail: () => (action === "return" ? void load() : undefined) },
      );
      // Приёмка и принудительное закрытие закрывают задачу на сервере —
      // «чпок» только после его «да» (lib/closeSound).
      if (action === "approve" || action === "force") playCloseSound();
      // Сверка фоном, а не ожиданием: решение сервер уже принял, окно можно
      // закрывать сразу — подписка принесёт новые строки следом.
      void load();
    },
    [load, clearAnswers],
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
  //
  // Экран меняется сразу (lib/answerPatch), а подтверждение — следом, и
  // кнопку оно больше не держит (23.10.2026: «Отправляю…» висело пару
  // секунд при уже обновлённом экране). Отказ сервера перечитывает
  // участие, то есть откатывает экран к правде, а причину показывает
  // тостом (postInBackground) — окно к этому моменту обычно уже закрыто.
  const answer = useCallback(
    async (raw: Record<string, unknown>) => {
      const participantId = await realParticipantId(String(raw.participantId || ""));
      if (raw.participantId && !participantId) throw new Error("Задача ещё не доехала до облака — попробуйте через минуту");
      const payload = raw.participantId ? { ...raw, participantId } : raw;
      const patch = answerPatch(payload as AnswerPayload, new Date().toISOString());
      if (participantId && patch) {
        setByTask((prev) => {
          const next: Record<string, Participant[]> = {};
          for (const [taskId, list] of Object.entries(prev)) {
            next[taskId] = list.some((p) => p.id === participantId)
              ? list.map((p) => (p.id === participantId ? { ...p, ...patch } : p))
              : list;
          }
          return next;
        });
      }
      // Отказ сервера — экран возвращается к базе. Не дошло вовсе — ответ
      // ждёт сети в очереди и остаётся на экране (lib/outbox).
      postInBackground("/api/workspace/report", payload, { fallback: "Не получилось отправить ответ", onFail: load, onDone: load });
    },
    [load, realParticipantId],
  );

  const acceptWork = useCallback((participantId: string) => answer({ action: "accept", participantId }), [answer]);

  // По строке участия — её задача. Путь файла в корзине начинается с
  // пространства и id задачи, потому что права на корзину решают по первому
  // сегменту пути (миграция 0020), а строка участия знает свою задачу
  // только здесь: наверх уезжает один participantId.
  const taskIdOf = useCallback(
    (participantId: string) => {
      for (const [taskId, list] of Object.entries(byTask)) {
        if (list.some((p) => p.id === participantId)) return taskId;
      }
      return "";
    },
    [byTask],
  );
  // Отчёт с документами: файлы уезжают в корзину ЗДЕСЬ, а маршрут получает
  // только их описания (см. lib/resultFiles — там же причина, по которой
  // содержимое не идёт через серверную функцию). Не загрузился файл —
  // отчёт не уходит вовсе: отчёт без обещанного акта хуже, чем повторная
  // попытка, потому что постановщик прочитает его как полный.
  const reportWork = useCallback(
    async (shownId: string, comment: string, files: File[] = [], whole = false) => {
      // Задача — по показанной строке: у заготовки её знает только `seeded`.
      const taskId = taskIdOf(shownId) || Object.keys(seeded).find((t) => seeded[t].some((p) => p.id === shownId)) || "";
      const participantId = await realParticipantId(shownId);
      if (!participantId) throw new Error("Задача ещё не доехала до облака — попробуйте через минуту");
      const attachments = files.length ? await uploadResultFiles(taskId, files) : [];
      // whole — «сдал задачу целиком»: на приёмку, не дожидаясь остальных.
      return answer({ action: "done", participantId, comment, attachments, ...(whole ? { whole: true } : {}) });
    },
    [answer, taskIdOf, realParticipantId, seeded],
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
  // participantIds — кому именно вернуть (строки участия); пусто — всем,
  // кто ответил.
  const returnForRework = useCallback(
    (taskId: string, comment: string, participantIds?: string[]) => review("return", taskId, comment, participantIds),
    [review],
  );
  // «Дождаться всех»: задачу сдали целиком, а постановщик ждёт отчёт от
  // каждого. Ничьи ответы не снимаются.
  const waitForAll = useCallback((taskId: string, comment = "") => review("wait", taskId, comment), [review]);
  const forceClose = useCallback((taskId: string, reason: string) => review("force", taskId, reason), [review]);
  // Вернуть одному исполнителю, не дожидаясь остальных (см. return_one в
  // /api/workspace/review).
  const returnOne = useCallback(
    async (taskId: string, participantId: string, comment: string) => {
      clearAnswers(taskId, participantId);
      await postJson(
        "/api/workspace/review",
        { action: "return_one", taskId, participantId, comment },
        { fallback: "Не получилось вернуть", onFail: () => void load() },
      );
      // Сверка фоном: экран уже поменялся, подписка принесёт остальное.
      void load();
    },
    [load, clearAnswers],
  );
  // Приёмку снимает только сервер: колонка не принадлежит движку
  // синхронизации, и снятая в браузере галочка «сделано» оставляла задачу
  // в «Завершённых» навсегда.
  const reopen = useCallback((taskId: string, comment: string) => review("reopen", taskId, comment), [review]);

  const forTask = useCallback(
    (taskId: string) => {
      const real = byTask[taskId] || [];
      const draft = seeded[taskId];
      if (!draft) return real;
      return [...real, ...draft.filter((d) => !real.some((p) => p.assigneeId === d.assigneeId))];
    },
    [byTask, seeded],
  );

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
      returnOne,
      waitForAll,
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
      returnOne,
      waitForAll,
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
