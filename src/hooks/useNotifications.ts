"use client";

// Port of legacy-tracker.js's checkDueTasks()/checkMeetingReminders()/
// browserNotify()/refreshPermBtn()/fireOnce() — client-side polling for
// "task due today", "task overdue", and "meeting starting in 15min/now".
// `notified` (which keys have already fired) stays in localStorage, same
// as legacy — it's a per-device "don't repeat this notification" cache,
// deliberately never synced to Supabase.
import { useCallback, useEffect, useRef, useState } from "react";
import { isDueToday, isOverdue, refreshRecurringStatuses, todayStr } from "@/lib/taskDisplay";
import type { Meeting, Task } from "@/types/tracker";

const LS_NOTIFIED = "kkt_notified_v2";

function loadNotified(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_NOTIFIED);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveNotified(v: Record<string, boolean>) {
  try {
    localStorage.setItem(LS_NOTIFIED, JSON.stringify(v));
  } catch {
    /* best effort, same as legacy's save() */
  }
}

function hasNotificationApi(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function useNotifications({
  tasks,
  meetings,
  saveTask,
  showToast,
  ready,
}: {
  tasks: Task[];
  meetings: Meeting[];
  saveTask: (task: Task) => void;
  showToast: (title: string, body?: string) => void;
  // useTrackerData's initial load is async — this hook mounts (and its
  // effects run) before `tasks`/`meetings` are populated. Running the
  // first check on that empty snapshot, gated only on an empty-deps mount
  // effect, would mean the real first check doesn't happen until the 60s
  // interval — pass `!loading` here so it waits for real data instead.
  ready: boolean;
}) {
  const notifiedRef = useRef<Record<string, boolean>>({});
  const [bannerText, setBannerText] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    notifiedRef.current = loadNotified();
    // Notification/localStorage don't exist during SSR — this has to be an
    // effect, not computed at render time. One-shot read of a browser API
    // on mount, not a subscription, so a plain setState here is correct.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPermission(hasNotificationApi() ? Notification.permission : "unsupported");
  }, []);

  function markNotified(key: string) {
    notifiedRef.current = { ...notifiedRef.current, [key]: true };
    saveNotified(notifiedRef.current);
  }

  function browserNotify(title: string, body: string) {
    if (hasNotificationApi() && Notification.permission === "granted") {
      try {
        new Notification(title, { body });
      } catch {
        /* ignore — same as legacy's try/catch around `new Notification` */
      }
    }
  }

  const checkDueTasks = useCallback(() => {
    const { tasks: refreshed, changed } = refreshRecurringStatuses(tasks);
    if (changed) {
      refreshed.forEach((t, i) => {
        if (t !== tasks[i]) saveTask(t);
      });
    }

    const today = todayStr();
    let overdueCount = 0;
    let dueTodayCount = 0;

    refreshed.forEach((t) => {
      if (t.status === "done") return;
      let due = false;
      let label = "";
      if (t.recur === "none") {
        if (t.deadline === today) {
          due = true;
          label = t.title;
        }
        if (isOverdue(t)) overdueCount++;
      } else if (isDueToday(t)) {
        due = true;
        label = t.title + " (повторяющаяся)";
      }
      if (!due) return;
      dueTodayCount++;
      const toastKey = `toast_${t.id}_${today}`;
      const nativeKey = `native_${t.id}_${today}`;
      if (!notifiedRef.current[toastKey]) {
        markNotified(toastKey);
        showToast("Задача на сегодня", label + (t.assignee ? " — " + t.assignee : ""));
      }
      if (!notifiedRef.current[nativeKey]) {
        browserNotify("Задача на сегодня: " + t.title, t.assignee || "");
        if (hasNotificationApi() && Notification.permission === "granted") markNotified(nativeKey);
      }
    });

    if (overdueCount > 0 || dueTodayCount > 0) {
      const parts: string[] = [];
      if (overdueCount > 0) parts.push(`${overdueCount} просроченных`);
      if (dueTodayCount > 0) parts.push(`${dueTodayCount} на сегодня`);
      setBannerText(`⚠ ${parts.join(", ")} — проверьте список задач.`);
    } else {
      setBannerText(null);
    }
  }, [tasks, saveTask, showToast]);

  const checkMeetingReminders = useCallback(() => {
    const today = todayStr();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    function fireOnce(key: string, fn: () => void, requireGranted?: boolean) {
      if (notifiedRef.current[key]) return;
      fn();
      if (!requireGranted || (hasNotificationApi() && Notification.permission === "granted")) markNotified(key);
    }

    meetings.forEach((m) => {
      if (m.date !== today || !m.time) return;
      const [hh, mm] = m.time.split(":").map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) return;
      const mMin = hh * 60 + mm;
      const who = m.participants.length ? " · " + m.participants.join(", ") : "";

      if (nowMin >= mMin - 15 && nowMin < mMin) {
        fireOnce(`toast_meet15_${m.id}_${today}`, () => showToast("Встреча через 15 минут", `${m.time} — ${m.title}${who}`));
        fireOnce(`native_meet15_${m.id}_${today}`, () => browserNotify("Через 15 минут: " + m.title, m.time + who), true);
      }
      if (nowMin >= mMin && nowMin <= mMin + 1) {
        fireOnce(`toast_meet0_${m.id}_${today}`, () => showToast("Встреча начинается", `${m.time} — ${m.title}${who}`));
        fireOnce(`native_meet0_${m.id}_${today}`, () => browserNotify("Встреча сейчас: " + m.title, m.time + who), true);
      }
    });
  }, [meetings, showToast]);

  // Always call the latest closures (fresh tasks/meetings) from a single
  // interval set up once on mount — same ref-forwarding pattern as
  // useTrackerData's persistAll retry timer, for the same reason.
  const checkDueTasksRef = useRef(checkDueTasks);
  const checkMeetingRemindersRef = useRef(checkMeetingReminders);
  useEffect(() => {
    checkDueTasksRef.current = checkDueTasks;
  }, [checkDueTasks]);
  useEffect(() => {
    checkMeetingRemindersRef.current = checkMeetingReminders;
  }, [checkMeetingReminders]);

  useEffect(() => {
    if (!ready) return;
    checkDueTasksRef.current();
    checkMeetingRemindersRef.current();
    const dueTimer = setInterval(() => checkDueTasksRef.current(), 60000);
    const meetTimer = setInterval(() => checkMeetingRemindersRef.current(), 60000);
    return () => {
      clearInterval(dueTimer);
      clearInterval(meetTimer);
    };
  }, [ready]);

  const requestPermission = useCallback(() => {
    if (hasNotificationApi() && Notification.permission !== "granted") {
      Notification.requestPermission().then((p) => {
        setPermission(p);
        // Permission was just granted — immediately flush native pushes
        // for anything already due today that only managed to toast so
        // far (see the "toast and native use separate keys" comment this
        // mirrors in legacy-tracker.js).
        checkDueTasksRef.current();
        checkMeetingRemindersRef.current();
      });
    }
  }, []);

  return { bannerText, permission, requestPermission };
}
