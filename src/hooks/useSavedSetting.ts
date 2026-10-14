"use client";

import { useState } from "react";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";

// Настройка взгляда на трекер, которая переживает перезапуск.
//
// Слова Кирилла 14.10.2026: «важно, чтоб у всех пользователей запоминались
// автоматически их фильтры и при перезапуске программа открывалась с ранее
// настроенной фильтрацией и настройками». До этого фильтры доски жили
// только в памяти вкладки, и каждое открытие начиналось с «Все».
//
// Хранится в браузере, а не в базе, и это решение: это свойство того, как
// человек смотрит на свою доску на этом компьютере, а не данные трекера
// (то же правило, что у сворачивания столбцов и у «тишины» уведомлений).
// Ключ — свой у каждого входа (auth-id): на общем компьютере у двоих свои
// фильтры, и чужой отбор не встретит человека пустой доской.
//
// Читается в ленивом инициализаторе, а при смене входа — прямо во время
// отрисовки (setState в теле, под условием): эффект с setState запрещает
// линтер React-компилятора, и он же дал бы кадр со старым значением.
function storageKey(userId: string, name: string) {
  return `rokas.setting.${userId || "anon"}.${name}`;
}

function read<T>(key: string, initial: T): T {
  try {
    if (typeof localStorage === "undefined") return initial;
    const raw = localStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

export function useSavedSetting<T>(name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const { userId } = useWorkspaceRole();
  const key = storageKey(userId, name);
  const [state, setState] = useState(() => ({ key, value: read(key, initial) }));
  if (state.key !== key) setState({ key, value: read(key, initial) });

  // Значение или функция от прежнего — как у обычного setState: два
  // нажатия подряд, пришедшие раньше перерисовки, иначе считались бы
  // оба от одного и того же старого значения, и первое терялось.
  function set(next: T | ((prev: T) => T)) {
    setState((prev) => {
      const base = prev.key === key ? prev.value : read(key, initial);
      const value = typeof next === "function" ? (next as (p: T) => T)(base) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* приватное окно или запрет хранилища — фильтр работает, просто не запомнится */
      }
      return { key, value };
    });
  }
  return [state.key === key ? state.value : read(key, initial), set];
}
