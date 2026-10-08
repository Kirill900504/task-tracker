"use client";

import { useCallback, useEffect, useState } from "react";
import { coalescer } from "@/lib/coalesce";
import { createClient } from "@/lib/supabase/client";
import { onRevive } from "@/lib/revive";
import { me } from "@/lib/me";
import { isSelfAssignee } from "@/lib/trackerRows";
import type { IdeaRecipientRow } from "@/lib/ideaRecipients";

// Строки рассылки мыслей: кому мысль ушла и что он с ней сделал.
//
// Один экземпляр на панель мыслей (IdeasPanel) — оттуда автору уходит
// «кому отправлена», получателю «что прислали». Права решает база: автор
// видит строки своих мыслей (миграция 0050), получатель — свои, владелец
// пространства — все (и фильтрует по своим мыслям сам: панель показывает
// только их).
//
// Всё, что блоку нужно, хук приносит САМ и одним заходом: строки, имена
// людей, имена авторов и свою строку. Первая версия брала имена и «кто я»
// из общих справочников (useColleagues, useAuthors), и блок «Прислали вам»
// появлялся через секунду после остальной панели — ждал три сетевых ответа
// подряд, а справочники в кэше между запусками не живут. Слова Кирилла
// 07.10.2026: «при открытии приложения появляется с задержкой, сделай так,
// чтобы никаких задержек не было и все разделы открывались синхронно».
//
// Поэтому же ответ прошлого запуска лежит в localStorage под своим auth-id
// и отдаётся первым кадром — то же правило, что у участия в задачах
// (useTaskParticipants): на пути к первому кадру нет обязательного
// сетевого ответа. Свежий приходит следом и заменяет его.

export type IdeaInbox = {
  rows: IdeaRecipientRow[];
  // id строки человека → имя, как оно записано (с «(я)» у владельца).
  names: Record<string, string>;
  // auth-id руководителя → имя: кто прислал мысль.
  authors: Record<string, string>;
  // Моя строка в списке людей — по ней ищутся присланные мне мысли.
  myAssigneeId: string;
  // Чей это ответ — под этим auth-id он и запоминается.
  userId: string;
};

const EMPTY: IdeaInbox = { rows: [], names: {}, authors: {}, myAssigneeId: "", userId: "" };
const CACHE_KEY = "kkt_idea_inbox";

type IdeaJoin = { text: string; created_by: string | null; created_at: string; done: boolean; deleted_at: string | null };
type Raw = {
  id: string;
  idea_id: string;
  assignee_id: string;
  seen_at: string | null;
  converted_task_id: string | null;
  created_at: string;
  ideas: IdeaJoin | IdeaJoin[] | null;
};

function toRow(raw: Raw): IdeaRecipientRow {
  const idea = Array.isArray(raw.ideas) ? raw.ideas[0] || null : raw.ideas;
  return {
    id: raw.id,
    ideaId: raw.idea_id,
    assigneeId: raw.assignee_id,
    seenAt: raw.seen_at,
    convertedTaskId: raw.converted_task_id,
    createdAt: raw.created_at,
    idea: idea
      ? { text: idea.text, createdBy: idea.created_by, createdAt: idea.created_at, done: !!idea.done, deletedAt: idea.deleted_at }
      : null,
  };
}

// Свой auth-id — тот же, под которым useWorkspaceRole кладёт роль: чужой
// кэш на общем компьютере не показывается.
function cacheOwner(): string {
  try {
    const raw = localStorage.getItem("kkt_identity");
    return raw ? JSON.parse(raw).userId || "" : "";
  } catch {
    return "";
  }
}

function readCache(): IdeaInbox | null {
  const uid = cacheOwner();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { userId: string; inbox: IdeaInbox };
    return saved.userId === uid ? saved.inbox : null;
  } catch {
    return null;
  }
}

// Пишется под тем, кто спросил, — по ответу самого запроса, а не по
// метке useWorkspaceRole. На первом входе запрос, начатый заранее
// (prefetchIdeaInbox), отвечает РАНЬШЕ, чем роль успевает записать метку:
// запись по метке тихо не происходила, и следующее открытие снова ждало
// сеть. Поймал общий e2e-прогон, а не одиночный — в одиночном роль
// обычно успевала первой.
function writeCache(inbox: IdeaInbox) {
  const uid = inbox.userId;
  if (!uid) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: uid, inbox }));
  } catch {
    /* приватный режим или переполнение — следующий старт просто без кэша */
  }
}

async function fetchInbox(): Promise<IdeaInbox | null> {
  const db = createClient();
  // Четыре вопроса разом, а не по очереди: каждый — полёт до базы.
  const [recipients, people, members, who] = await Promise.all([
    db
      .from("idea_recipients")
      .select("id, idea_id, assignee_id, seen_at, converted_task_id, created_at, ideas(text, created_by, created_at, done, deleted_at)"),
    db.from("assignees").select("id, name"),
    db.from("workspace_members").select("member_id, assignees(name)").not("member_id", "is", null),
    me(),
  ]);
  // Отказ сети — не повод стереть то, что на экране: вернём null, и
  // останется прошлый ответ.
  if (recipients.error || people.error) return null;

  const names: Record<string, string> = {};
  for (const p of (people.data || []) as { id: string; name: string }[]) names[p.id] = p.name;

  type Member = { member_id: string; assignees: { name: string } | { name: string }[] | null };
  const authors: Record<string, string> = {};
  for (const m of (members.data || []) as unknown as Member[]) {
    const name = (Array.isArray(m.assignees) ? m.assignees[0]?.name : m.assignees?.name) || "";
    if (m.member_id && name) authors[m.member_id] = name;
  }

  // У руководителя своя строка — из членства. У владельца членства нет, и
  // его строка — та, что помечена «(я)» (тем же правилом, что в useColleagues).
  const myAssigneeId =
    who.assigneeId || Object.entries(names).find(([, name]) => isSelfAssignee(name))?.[0] || "";

  return { rows: ((recipients.data || []) as Raw[]).map(toRow), names, authors, myAssigneeId, userId: who.userId };
}

// Запрос, начатый заранее. Панель мыслей появляется только после того,
// как приехали роль и данные трекера, — а этому запросу ни то, ни другое
// не нужно. IdeasPanel зовёт prefetch при загрузке своего кода, то есть
// одновременно с остальными запросами, и к первому кадру ответ обычно уже
// есть даже на первом запуске, когда кэша ещё нет. Живёт десять секунд:
// дальше это уже не «заранее», а устаревшее.
let early: { at: number; promise: Promise<IdeaInbox | null> } | null = null;

export function prefetchIdeaInbox() {
  if (typeof window === "undefined") return;
  if (early && Date.now() - early.at < 10_000) return;
  early = { at: Date.now(), promise: fetchInbox().catch(() => null) };
}

function takeEarly(): Promise<IdeaInbox | null> {
  const ready = early && Date.now() - early.at < 10_000 ? early.promise : fetchInbox();
  early = null;
  return ready;
}

export function useIdeaRecipients() {
  // Прошлый ответ — в ленивом инициализаторе, ровно один раз: строка в
  // теле компонента разбирала бы JSON на каждую перерисовку
  // (см. useTaskParticipants, там это однажды повесило экран).
  const [inbox, setInbox] = useState<IdeaInbox>(() => (typeof window === "undefined" ? EMPTY : readCache() || EMPTY));

  useEffect(() => {
    let cancelled = false;
    // Отправка мысли — несколько строк разом, и каждая приходит событием:
    // склеиваем их в одно чтение (lib/coalesce).
    let first = true;
    const reader = coalescer(async () => {
      const next = first ? await takeEarly() : await fetchInbox();
      first = false;
      if (cancelled || !next) return;
      setInbox(next);
      writeCache(next);
    });
    void reader.now();

    const db = createClient();
    // Имя канала своё на каждый вызов: повторная подписка на уже
    // подписанный канал бросает исключение (см. useMeetingVotes).
    const channel = db
      .channel("idea-recipients:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "idea_recipients" }, reader.soon)
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !reader.startedWithin(2000)) reader.soon();
      });
    // Подписка умирает молча — у мыслей тот же второй путь, что у всего
    // остального (lib/revive.ts).
    const stopRevive = onRevive(reader.soon);

    return () => {
      cancelled = true;
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, []);

  // Экран отвечает раньше облака: ответ рисуется сразу, а не после
  // перечитывания. Не прошла запись — перечитываем, и строка возвращается.
  const markLocally = useCallback((rowId: string, patch: Partial<IdeaRecipientRow>) => {
    setInbox((prev) => {
      const next = { ...prev, rows: prev.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) };
      // Отвеченное не должно вернуться на следующем запуске из кэша.
      writeCache(next);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const next = await fetchInbox();
    if (next) {
      setInbox(next);
      writeCache(next);
    }
  }, []);

  return { ...inbox, markLocally, reload };
}
