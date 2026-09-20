"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";
import { me } from "@/lib/me";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { createSharedStore } from "@/lib/sharedStore";
import type { MemberRole } from "@/hooks/useWorkspaceRole";

// Who on the team is reachable in a messenger.
//
// The tracker's own assignee list is plain names (that is all a task needs);
// the connection to a chat lives on the same row in the database and is only
// interesting in two places: the team screen, and the "send" buttons, which
// have to know whether there is anywhere to send to. So it is loaded here
// rather than threaded through the whole app.
//
// A person can be connected to Telegram, to MAX, or to both; `linked` means
// "reachable at all", which is what the send buttons care about.

export type ColleagueChannel = "telegram" | "max";

// Whether this person also has a LOGIN, which is a different question from
// whether a bot can write to him: a manager may live entirely in Telegram,
// entirely in the tracker, or in both.
export type MemberState = "none" | "invited" | "active" | "disabled";

export type Colleague = {
  id: string;
  name: string;
  // Направление, которое человек ведёт. Пусто, пока его не указали при
  // приглашении: понедельничная сводка группирует людей по нему.
  direction: string;
  linked: boolean;
  telegram: boolean;
  max: boolean;
  username: string | null;
  member: MemberState;
  // Что человеку позволено сверх собственной работы (миграция 0036).
  role: MemberRole;
  // Это я. Себе не отправляют и себя не приглашают, поэтому список читают
  // с оглядкой на этот флаг; в «Команде» своя строка видна — иначе узнать,
  // под каким именем тебя видят остальные, негде.
  isMe: boolean;
};

// Есть ли бот MAX — теперь вопрос к базе, а не к сборке: см. useMaxBot.

async function fetchColleagues(): Promise<Colleague[] | null> {
  const db = createClient();
  const { data, error } = await db
    .from("assignees")
    .select("id, name, telegram_chat_id, telegram_username, max_user_id, max_username")
    .order("created_at");
  if (error || !data) return null;

  // Read separately and forgivingly: this table arrives with migration 0019,
  // and a deployment that is ahead of its database must still show the team
  // screen rather than an empty one. An error here means "nobody has a login
  // yet", which is the truth in that situation anyway.
  const { data: members } = await db.from("workspace_members").select("assignee_id, status, direction, role");
  const memberOf = new Map<string, MemberState>();
  const directionOf = new Map<string, string>();
  const roleOf = new Map<string, MemberRole>();
  for (const row of members || []) {
    memberOf.set(row.assignee_id as string, (row.status as MemberState) || "none");
    directionOf.set(row.assignee_id as string, (row.direction as string) || "");
    const raw = row.role as string | null;
    roleOf.set(row.assignee_id as string, raw === "admin" || raw === "developer" ? raw : "manager");
  }

  // Своя строка отсюда уходит — и только своя.
  //
  // Здесь стоял фильтр по метке «(я)», то есть по строке ВЛАДЕЛЬЦА, с
  // объяснением «бот не может писать тому, кто им управляет». Для самого
  // Кирилла это верно и сейчас: себя не приглашают и себе не отправляют.
  // Для руководителя это означало, что владельца нет ни в списке «кому
  // отправить», ни среди тех, кого касается задача, — то есть послать ему
  // мысль или показать встречу было нельзя вовсе. Писать ему бот умеет
  // (его чат живёт в учётной записи, см. lib/reach), и по той же причине
  // его строка считается достижимой: подключён он или нет, из чужого
  // браузера не видно — это знает сервер, и он же скажет, если не дошло.
  const who = await me();
  const iAmOwner = !who.userId || who.userId === who.workspaceId;
  const isMine = (r: Record<string, unknown>) =>
    iAmOwner ? isSelfAssignee((r.name as string) || "") : (r.id as string) === who.assigneeId;

  // Своя строка из списка НЕ выбрасывается, а помечается: «Команда» — это
  // список людей пространства, и владелец в нём есть (он сам спросил, как
  // его видят остальные, а увидеть это было негде). Отправлять себе и
  // приглашать себя по-прежнему нельзя — это решают те, кто список
  // читает, по полю `isMe`.
  //
  // Порядок тот же, что и везде (peopleOrder.ts): «Команда» — это список
  // тех же людей, и читать его в другом порядке значит искать в нём заново.
  return sortByPeopleOrder(data, (r) => (r.name as string) || "")
    .map((r) => ({
      isMe: isMine(r),
      id: r.id as string,
      name: r.name as string,
      telegram: r.telegram_chat_id != null,
      max: r.max_user_id != null,
      linked: r.telegram_chat_id != null || r.max_user_id != null || isSelfAssignee((r.name as string) || ""),
      username: ((r.telegram_username || r.max_username) as string) || null,
      member: memberOf.get(r.id as string) || "none",
      direction: directionOf.get(r.id as string) || "",
      role: roleOf.get(r.id as string) || "manager",
    }));
}

// Один список на весь трекер. Его спрашивают карточка задачи, встреча,
// каждая мысль в панели, меню ✈ и окно «Команда» — и раньше каждый из них
// спрашивал его сам, с нуля и с собственным «Загрузка…». Именно это и было
// видно как «нажал „Команда“ — окно секунду думает»: ответ уже лежал в
// соседнем компоненте, но новое окно начинало с пустого места.
//
// За обеими таблицами следим: человек, нажавший «Start» в боте, меняет
// `assignees`, а принятое приглашение в трекер — `workspace_members`. И то и
// другое должно быть видно в открытом окне сразу — как всё остальное в
// трекере, а не через то время, на которое кому-то показался разумным кэш.
const team = createSharedStore<Colleague[]>([], fetchColleagues, ["assignees", "workspace_members"]);

// Прогрев из корня трекера. Список нужен в ту же секунду, когда нажали ✈ или
// «Команда», а нажимают их из уже открытого экрана — значит спросить можно
// заранее и бесплатно. Подписки здесь намеренно нет: корню незачем
// перерисовываться из-за списка, который он сам не показывает.
export function prefetchTeam() {
  team.ensure();
}

export function useColleagues() {
  const { data: colleagues, loaded } = useSyncExternalStore(team.subscribe, team.snapshot, team.serverSnapshot);

  const reload = useCallback(() => team.refresh(), []);

  useEffect(() => {
    // Загрузит один раз на всех; открытое позже окно получит уже готовый
    // список и молча освежит его фоном.
    team.ensure();
  }, []);

  // Returns the invite link to hand to the person — the code inside it is
  // what attaches their chat to this name when they press Start.
  const invite = useCallback(
    async (assigneeId: string, channel: ColleagueChannel): Promise<{ link: string; code: string } | { error: string }> => {
      const res = await fetch("/api/telegram/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId, channel }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось создать приглашение" };
      return { link: data.link as string, code: data.code as string };
    },
    [],
  );

  // The other kind of invitation: a login rather than a chat. Returns the
  // link to hand over — the same shape as `invite` above, so the team screen
  // treats the two the same way.
  const inviteToTracker = useCallback(
    async (assigneeId: string, direction = ""): Promise<{ link: string; code: string } | { error: string }> => {
      const res = await fetch("/api/workspace/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId, direction }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось создать приглашение" };
      // Ссылка отдаётся сразу — она и есть ответ на нажатие. Строка «приглашён
      // в трекер» проставляется здесь же, а не после ещё одного запроса:
      // приглашение уже создано, и ждать подтверждения того, что и так
      // известно, значит держать человека перед неменяющимся экраном.
      team.update((list) =>
        list.map((p) => (p.id === assigneeId ? { ...p, member: "invited" as MemberState, direction: direction || p.direction } : p)),
      );
      void reload();
      return { link: data.link as string, code: data.code as string };
    },
    [reload],
  );

  // Третий вид ссылки: не приглашение, а возвращение доступа тому, кто уже
  // входил. Приглашение после «в трекере» отвечает отказом — и правильно,
  // иначе человек завёл бы себе второй аккаунт мимо своих же задач. А
  // ссылку теряют и пароль забывают, и до недавнего времени это был тупик:
  // строка «в трекере» и ни одной кнопки рядом. Маршрут отдаёт почту, под
  // которой человек записан (в интерфейсе её больше негде увидеть), и
  // одноразовую ссылку на смену пароля для того же входа.
  const accessLink = useCallback(
    async (assigneeId: string): Promise<{ link: string; email: string } | { error: string }> => {
      const res = await fetch("/api/workspace/access-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось создать ссылку" };
      return { link: data.link as string, email: data.email as string };
    },
    [],
  );

  // Увольнение (A4): доступ выключается, данные остаются на месте. Строка
  // участия в задачах никуда не девается — иначе вместе с человеком из
  // трекера исчезло бы и то, что он делал, и задачи стали бы ничьими
  // задним числом.
  // Эти три пишут на экран раньше, чем в базу: нажатие кнопки — уже решение,
  // и строка, которая полсекунды показывает прежнее состояние, читается как
  // «не сработало». Правда догоняет фоновым перечитыванием, и если запись не
  // прошла, оно вернёт строку как было.
  const setDirection = useCallback(
    async (assigneeId: string, direction: string) => {
      team.update((list) => list.map((p) => (p.id === assigneeId ? { ...p, direction } : p)));
      const db = createClient();
      await db.from("workspace_members").update({ direction }).eq("assignee_id", assigneeId);
      await reload();
    },
    [reload],
  );

  // Права сверх собственной работы. Экран меняется сразу, база следом —
  // как и всё остальное в этом хуке: нажатие не должно ждать сеть.
  const setMemberRole = useCallback(
    async (assigneeId: string, role: MemberRole) => {
      team.update((list) => list.map((p) => (p.id === assigneeId ? { ...p, role } : p)));
      const db = createClient();
      await db.from("workspace_members").update({ role }).eq("assignee_id", assigneeId);
      await reload();
    },
    [reload],
  );

  const setTrackerAccess = useCallback(
    async (assigneeId: string, active: boolean) => {
      team.update((list) =>
        list.map((p) => (p.id === assigneeId ? { ...p, member: (active ? "active" : "disabled") as MemberState } : p)),
      );
      const db = createClient();
      await db
        .from("workspace_members")
        .update(
          active
            ? { status: "active", disabled_at: null }
            : { status: "disabled", disabled_at: new Date().toISOString() },
        )
        .eq("assignee_id", assigneeId);
      await reload();
    },
    [reload],
  );

  const unlink = useCallback(
    async (assigneeId: string, channel: ColleagueChannel) => {
      team.update((list) =>
        list.map((p) => {
          if (p.id !== assigneeId) return p;
          const telegram = channel === "telegram" ? false : p.telegram;
          const max = channel === "max" ? false : p.max;
          return { ...p, telegram, max, linked: telegram || max, username: telegram || max ? p.username : null };
        }),
      );
      const db = createClient();
      const patch =
        channel === "max"
          ? { max_user_id: null, max_username: null, max_linked_at: null }
          : { telegram_chat_id: null, telegram_username: null, linked_at: null };
      await db.from("assignees").update(patch).eq("id", assigneeId);
      await reload();
    },
    [reload],
  );

  // Переименовать человека.
  //
  // Единственное действие здесь, которое НЕ пишет в базу из браузера, и
  // причина существенная: имя написано ещё и на карточках задач и в
  // составе встреч, а чужую задачу браузеру переписывать нельзя (и
  // правильно). Маршрут делает три записи вместе — иначе имя и человек
  // разойдутся, и задача станет «назначенной только на словах».
  const rename = useCallback(
    async (assigneeId: string, name: string): Promise<string> => {
      const previous = colleagues.find((p) => p.id === assigneeId)?.name || "";
      // Экран отвечает раньше облака: имя меняется сразу, запись идёт
      // следом, и перечитывание случается только если она не прошла.
      team.update((list) => list.map((p) => (p.id === assigneeId ? { ...p, name } : p)));
      try {
        const res = await fetch("/api/workspace/rename-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigneeId, name }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          team.update((list) => list.map((p) => (p.id === assigneeId ? { ...p, name: previous } : p)));
          return data?.error || "Не получилось переименовать";
        }
        await reload();
        return data.warning ? `Имя изменено, но не везде: ${data.warning}` : "";
      } catch {
        team.update((list) => list.map((p) => (p.id === assigneeId ? { ...p, name: previous } : p)));
        return "Не удалось переименовать — проверьте связь";
      }
    },
    [colleagues, reload],
  );

  return {
    colleagues,
    loading: !loaded,
    reload,
    invite,
    inviteToTracker,
    accessLink,
    setDirection,
    setMemberRole,
    setTrackerAccess,
    unlink,
    rename,
  };
}

export type SendResult = { sentTo: string[]; failed: string[] } | { error: string };

// Sending is by id: the server reads the item back itself, so nothing about
// what gets written to a colleague comes from the browser. Which messenger
// it travels through is decided there too, from how the person is connected.
export async function sendToTelegram(kind: "task" | "meeting" | "idea", id: string, to?: string[]): Promise<SendResult> {
  const res = await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id, ...(to ? { to } : {}) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) return { error: data?.error || "Не получилось отправить" };
  return { sentTo: data.sentTo || [], failed: data.failed || [] };
}
