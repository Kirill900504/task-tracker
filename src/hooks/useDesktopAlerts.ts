"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { onRevive } from "@/lib/revive";
import { withoutSelfMark } from "@/lib/actorName";
import { isCreatedByMe } from "@/lib/ownership";
import { fmtDate } from "@/lib/taskDisplay";
import { muteKey, readAlertPrefs, toggleMuted, writeAlertPrefs } from "@/lib/alertPrefs";
import { alertForComment, alertForNewItem, type CommentRowForAlert, type DesktopAlert, type KnownItem } from "@/lib/desktopAlerts";
import type { ToastAction } from "@/hooks/useToasts";
import type { Meeting, Task } from "@/types/tracker";

// Всплывающие уведомления на ПК: окно Windows поверх всех программ, а
// нажатие на него открывает ту самую задачу или встречу.
//
// Что всплывает и почему — в lib/desktopAlerts. Здесь — откуда события
// берутся и куда показываются.
//
// *Откуда.* Подписка на item_comments будит опрос, а опрос спрашивает базу
// «что появилось после последней виденной строки». Подписка одна и без
// фильтра: прав на чтение хватает, чтобы база сама не прислала чужого, а
// видимость экрана проверяется уже здесь. Опрос, а не содержимое события, —
// по правилу «realtime — ускоритель, а не источник правды» (lib/revive):
// сокет умирает молча, и тогда те же строки приносит перечитывание раз в
// минуту, ничего не потеряв.
//
// *Куда.* Трекер на переднем плане — своё окошко в правом нижнем углу, с
// кнопками «Открыть» и «Не беспокоить»: окно Windows поверх окна, на
// которое человек и так смотрит, — лишнее. Трекер свёрнут или за другим
// окном — окно Windows; кнопок в нём нет (браузер их не даёт), нажатие на
// него поднимает трекер и открывает элемент. Разрешения на окна Windows
// нет — своё окошко: увидят, когда вернутся.

const BASELINE_MS = 15_000;
// Новая встреча ждёт: при переносе она появляется на экране раньше, чем
// строка «Перенесена с …» в её обсуждении, и без паузы человек получил бы
// два окна про одно событие — «вас позвали» и «перенесена».
const MEETING_HOLD_MS = 20_000;
// См. openFromAlert внизу.
const OPEN_EVENT = "rokas:open-item";

type Row = Omit<CommentRowForAlert, "authorName"> & {
  created_at: string;
  assignees: { name: string } | { name: string }[] | null;
};

export function useDesktopAlerts({
  ready,
  tasks,
  meetings,
  myUserId,
  myAssigneeId,
  mineOnlyId,
  showToast,
  openItem,
}: {
  ready: boolean;
  tasks: Task[];
  meetings: Meeting[];
  myUserId: string;
  myAssigneeId: string | null;
  // То же «я», что у правила «своё» (пусто у владельца — см. NewTracker).
  mineOnlyId: string;
  showToast: (title: string, body?: string, onUndo?: () => void, extra?: { onOpen?: () => void; actions?: ToastAction[] }) => void;
  openItem: (kind: "task" | "meeting", id: string) => void;
}) {
  const known = useRef(new Map<string, KnownItem>());
  const seen = useRef(new Set<string>());
  const shown = useRef(new Set<string>());
  const readySince = useRef(0);
  // Самое свежее в функциях, которые живут в подписке и таймерах.
  const latest = useRef({ myUserId, myAssigneeId, showToast, openItem });
  useEffect(() => {
    latest.current = { myUserId, myAssigneeId, showToast, openItem };
  }, [myUserId, myAssigneeId, showToast, openItem]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { kind, id } = (e as CustomEvent<{ kind: "task" | "meeting"; id: string }>).detail;
      latest.current.openItem(kind, id);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  function deliver(alert: DesktopAlert) {
    if (shown.current.has(alert.key)) return;
    shown.current.add(alert.key);
    const { showToast: toast, openItem: open } = latest.current;
    const key = muteKey(alert.kind, alert.itemId);
    const focused = document.visibilityState === "visible" && document.hasFocus();
    // Обсуждение этого элемента открыто перед глазами — новость уже на
    // экране, повторять её окном незачем.
    if (focused && document.querySelector(`dialog[open] [data-chat="${key}"]`)) return;

    const openIt = () => open(alert.kind, alert.itemId);
    if (focused || !canNotify()) {
      const actions: ToastAction[] = [];
      if (alert.category === "message") {
        actions.push({ label: alert.kind === "task" ? "Не беспокоить по задаче" : "Не беспокоить по встрече", onClick: () => toggleMuted(alert.kind, alert.itemId) });
      }
      if (alert.category === "progress") actions.push({ label: "Не показывать ход работы", onClick: () => writeAlertPrefs({ progress: false }) });
      toast(alert.title, alert.body, undefined, { onOpen: openIt, actions });
      return;
    }
    try {
      const n = new Notification(alert.title, { body: alert.body, tag: alert.key, icon: "/icon-192.png" });
      n.onclick = () => {
        raiseWindow();
        openIt();
        n.close();
      };
    } catch {
      toast(alert.title, alert.body, undefined, { onOpen: openIt });
    }
  }

  // Что я вижу — и что видел: отменённая встреча к моменту строки «отменил»
  // уже исчезла из списка, а сообщить о ней надо.
  useEffect(() => {
    if (!ready) return;
    if (!readySince.current) readySince.current = Date.now();
    const quietStart = Date.now() - readySince.current < BASELINE_MS;
    const fresh: { kind: "task" | "meeting"; id: string; title: string; when: string }[] = [];

    for (const t of tasks) {
      const key = muteKey("task", t.id);
      known.current.set(key, { kind: "task", title: t.title });
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (quietStart || t.status === "done" || isCreatedByMe(t, mineOnlyId)) continue;
      fresh.push({ kind: "task", id: t.id, title: t.title, when: t.deadline ? "Срок: " + fmtDate(t.deadline) : "" });
    }
    for (const m of meetings) {
      const key = muteKey("meeting", m.id);
      known.current.set(key, { kind: "meeting", title: m.title });
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (quietStart || (m.status !== "planned" && m.status !== "proposed") || isCreatedByMe(m, mineOnlyId)) continue;
      fresh.push({ kind: "meeting", id: m.id, title: m.title, when: fmtDate(m.date) + (m.time ? ", " + m.time : "") });
    }
    // Пачка разом — это догрузка (участие доехало позже задач, вернулась
    // связь после ночи), а не шесть новых поручений за секунду.
    if (fresh.length > 4) return;
    for (const item of fresh) {
      const alert = alertForNewItem(item, readAlertPrefs());
      if (!alert) continue;
      if (item.kind === "task") deliver(alert);
      else
        setTimeout(() => {
          // Перенос уже сказал о себе — эта встреча не новая, а прежняя.
          if (!shown.current.has("moved:" + item.id)) deliver(alert);
        }, MEETING_HOLD_MS);
    }
  }, [ready, tasks, meetings, mineOnlyId]);

  // Строки обсуждений.
  useEffect(() => {
    if (!ready) return;
    const db = createClient();
    let cancelled = false;
    let watermark = "";
    let running = false;
    let again = false;

    async function poll() {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        if (!watermark) {
          // Отсчёт — от последней строки, которую знает база, а не от часов
          // этого компьютера: часы бывают впереди сервера, и тогда первые
          // минуты событий пропали бы.
          const { data } = await db.from("item_comments").select("created_at").order("created_at", { ascending: false }).limit(1);
          watermark = ((data || []) as { created_at: string }[])[0]?.created_at || new Date(0).toISOString();
          return;
        }
        const { data } = await db
          .from("item_comments")
          .select("id, item_kind, item_id, body, system, author_user_id, author_assignee_id, created_at, assignees(name)")
          // «Не раньше», а не «позже»: две строки одной миллисекунды
          // (перенос пишет в обе встречи разом) иначе теряли бы вторую.
          // Повтор последней виденной отсекает отпечаток в deliver.
          .gte("created_at", watermark)
          .in("item_kind", ["task", "meeting"])
          .is("deleted_at", null)
          .order("created_at")
          .limit(30);
        if (cancelled) return;
        const rows = (data || []) as unknown as Row[];
        if (!rows.length) return;
        watermark = rows[rows.length - 1].created_at;
        const { myUserId: me, myAssigneeId: meRow } = latest.current;
        const prefs = readAlertPrefs();
        for (const r of rows) {
          const a = Array.isArray(r.assignees) ? r.assignees[0] : r.assignees;
          const alert = alertForComment(
            { ...r, authorName: withoutSelfMark(a?.name || "") || "Кирилл" },
            { myUserId: me, myAssigneeId: meRow, known: known.current, prefs },
          );
          if (!alert) continue;
          if (alert.category === "moved") shown.current.add("moved:" + alert.itemId);
          deliver(alert);
        }
      } finally {
        running = false;
        if (again && !cancelled) {
          again = false;
          void poll();
        }
      }
    }

    void poll();
    const channel = db
      .channel("desktop-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "item_comments" }, () => void poll())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void poll();
      });
    const stopRevive = onRevive(() => void poll(), { everyMs: 60_000 });
    return () => {
      cancelled = true;
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [ready]);
}

// Открыть задачу или встречу по нажатию на уведомление — откуда бы оно ни
// пришло. Напоминание о встрече живёт в своём хуке (useNotifications) и
// своего доступа к окнам трекера не имеет; событие окна сводит оба пути в
// одно место — в openItem, который этот хук получил от NewTracker.
export function openFromAlert(kind: "task" | "meeting", id: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { kind, id } }));
}

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

// Поднять окно трекера над остальными.
//
// Во вкладке браузера это window.focus() — нажатие на уведомление даёт
// странице такое право. В настольном приложении этого мало: страница не
// может поднять окно Electron сама, а мостика между ней и оболочкой нет
// намеренно (desktop/main.js — «no preload, no bridge to abuse»). Поэтому
// страница подаёт знак, который оболочка и так видит: переход внутри
// страницы на адрес с меткой. Оболочка ловит его (did-navigate-in-page),
// разворачивает и поднимает окно, а метка тут же снимается.
export function raiseWindow(): void {
  try {
    window.focus();
  } catch {
    // Не дали — значит, окно поднимет оболочка или сам человек.
  }
  if (!/Electron/.test(navigator.userAgent)) return;
  const back = location.pathname + location.search + location.hash;
  try {
    history.replaceState(history.state, "", location.pathname + location.search + "#rokas-raise");
    history.replaceState(history.state, "", back);
  } catch {
    // Старые версии оболочки этой метки не знают — окно не поднимется, но
    // элемент всё равно откроется внутри.
  }
}
