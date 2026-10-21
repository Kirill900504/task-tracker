"use client";

import { useSyncExternalStore } from "react";

// Текущая минута, от которой зависит то, что на экране.
//
// Часть состояний в трекере выводится из ВРЕМЕНИ, а не из данных: встреча
// «Нужен итог», как только её время вышло. Считались они при перерисовке —
// а время само по себе ничего не перерисовывает. Догон (`lib/revive`)
// перечитывает базу раз в минуту, но до экрана доходит только изменившееся
// (`sameLists`), так что у встречи, о которой никто ничего не писал, повода
// перерисоваться не было вовсе: «тест просрочка» в 9:00 так и стояла в
// общем списке (21.10.2026). Эти часы и есть такой повод — раз в минуту.
//
// Один таймер на всех подписчиков: карточек встреч бывают десятки, и у
// каждой свой интервал — это десятки пробуждений вместо одного.

const listeners = new Set<() => void>();
let minute = Math.floor(Date.now() / 60_000);
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const next = Math.floor(Date.now() / 60_000);
  if (next === minute) return;
  minute = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Проснувшийся ноутбук и вернувшаяся вкладка узнают о новой минуте сразу,
  // а не на следующем тике спящего таймера.
  if (!timer) {
    timer = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
  }
  tick();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

const getSnapshot = () => minute;
// На сервере часов нет: первый кадр считается по минуте сборки страницы,
// и браузер поправит его на первом же тике.
const getServerSnapshot = () => minute;

// Возвращает Date той минуты, на которую экран сейчас посчитан.
export function useMinuteClock(): Date {
  const m = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return new Date(m * 60_000);
}
