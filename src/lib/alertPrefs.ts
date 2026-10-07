"use client";

import { useSyncExternalStore } from "react";

// Что из всплывающих уведомлений человек выключил у себя.
//
// Слова Кирилла 07.10.2026: «обязательно должны всплывать любые новые
// сообщения от коллег, но так же нужно и предусмотреть иконку или кнопочку
// „отключить уведомления“, чтобы любой человек мог мутить менее важные
// события при работе в трекере». Отсюда три рычага, и у каждого своя
// причина существовать:
//
// *Категории* — выключается только второстепенное: ход работы («принял»,
// «сдал», «итог встречи») и напоминание за 15 минут до встречи. Реплика
// коллеги, новая задача на вас и перенос или отмена вашей встречи из
// настроек не выключаются: это то, ради чего уведомления вообще есть, и
// человек, однажды их выключивший, пропустит ровно то, что от него ждут.
// *Тишина на час* — для того самого «при работе»: сосредоточиться, не
// разбирая, что важно, а что нет. Кончается сама: забытая тишина — это
// уведомления, выключенные навсегда без ведома человека.
// *Обсуждение без уведомлений* — как «без звука» у чата в Telegram: одна
// шумная задача не повод глушить остальные. Перенос встречи сквозь это
// всё равно проходит — он меняет то, куда человеку идти.
//
// Хранится в браузере, а не в базе, и это решение: всплывающее окно —
// свойство этого компьютера (на телефоне его нет вовсе), а мессенджер и
// утренняя сводка этими рычагами не управляются. Решение 2026-09 «никаких
// настроек уведомлений на человека» (docs/next-ten.md) было про бота, и
// оно в силе: бот пишет только то, что нельзя не сказать.

export type AlertPrefs = {
  // Ход работы: принял, сдал, вернул, итог, «напомнил об итоге».
  progress: boolean;
  // Встреча через 15 минут.
  reminders: boolean;
  // До какого момента молчать (ISO), пусто — тишины нет.
  quietUntil: string;
  // Заглушённые обсуждения: "task:<id>" / "meeting:<id>".
  muted: string[];
};

const KEY = "rokas:alert-prefs";
const EVENT = "rokas:alert-prefs";
const DEFAULTS: AlertPrefs = { progress: true, reminders: true, quietUntil: "", muted: [] };

// Один объект на одно значение в хранилище: useSyncExternalStore требует,
// чтобы снимок не менялся между двумя чтениями без изменения данных.
let cachedRaw: string | null | undefined;
let cached: AlertPrefs = DEFAULTS;

export function readAlertPrefs(): AlertPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Приватный режим — живём на значениях по умолчанию.
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<AlertPrefs>) : {};
    cached = {
      progress: parsed.progress !== false,
      reminders: parsed.reminders !== false,
      quietUntil: typeof parsed.quietUntil === "string" ? parsed.quietUntil : "",
      muted: Array.isArray(parsed.muted) ? parsed.muted.filter((x) => typeof x === "string") : [],
    };
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

export function writeAlertPrefs(patch: Partial<AlertPrefs>): void {
  const next = { ...readAlertPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Не сохранилось — значит, до перезагрузки; хуже от этого не станет.
  }
  window.dispatchEvent(new Event(EVENT));
}

export const muteKey = (kind: "task" | "meeting", id: string) => kind + ":" + id;

export function isQuiet(prefs: AlertPrefs, now: Date = new Date()): boolean {
  return !!prefs.quietUntil && new Date(prefs.quietUntil).getTime() > now.getTime();
}

export function toggleMuted(kind: "task" | "meeting", id: string): void {
  const key = muteKey(kind, id);
  const { muted } = readAlertPrefs();
  // Хвост в двести строк: закрытые задачи отсюда никто не вычищает, а
  // список, растущий вечно, — это тот самый архив, который не нужен.
  writeAlertPrefs({ muted: muted.includes(key) ? muted.filter((x) => x !== key) : [...muted, key].slice(-200) });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  // Вторая вкладка того же трекера поменяла настройки — эта узнаёт сразу.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useAlertPrefs(): AlertPrefs {
  return useSyncExternalStore(subscribe, readAlertPrefs, () => DEFAULTS);
}
