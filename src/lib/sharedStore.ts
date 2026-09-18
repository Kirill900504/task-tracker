"use client";

import { createClient } from "@/lib/supabase/client";

// Список, который нужен сразу нескольким окнам, — один на всех.
//
// Почему это понадобилось. Хук вида «загрузить при монтировании» выглядит
// безобидно ровно до тех пор, пока его не вызывают из пяти мест: список
// команды читают и карточка задачи, и встреча, и КАЖДАЯ мысль в панели, и
// меню ✈, и окно «Команда». Каждая копия хука честно шла в базу за одним и
// тем же, и каждая ждала своего ответа. Отсюда и «нажал „Команда“ — окно
// секунду думает»: окно открывалось пустым и ждало запрос, ответ на который
// уже лежал в соседнем компоненте.
//
// Поэтому данные живут не в компоненте, а рядом с ним: один снимок, один
// запрос на всех (`ensure` склеивает одновременные вызовы в один), и окно
// открывается на том, что уже известно, а свежесть догоняет фоном. Никакого
// «Загрузка…» там, где ответ есть.
//
// Это НЕ замена движку синхронизации задач (useTrackerData): тот владеет
// своими колонками и своим оптимистичным состоянием. Здесь — короткие
// справочники, которые только читают и изредка правят кнопкой.

export type Snapshot<T> = { data: T; loaded: boolean };

export type SharedStore<T> = {
  snapshot: () => Snapshot<T>;
  serverSnapshot: () => Snapshot<T>;
  subscribe: (fn: () => void) => () => void;
  // Записать локально то, что уже произошло на экране, не дожидаясь базы.
  update: (change: (current: T) => T) => void;
  // Загрузить, если ещё не загружали или данные успели устареть.
  ensure: () => void;
  // Перечитать безусловно — после записи или по кнопке «проверить».
  refresh: () => Promise<void>;
};

// Сколько данные считаются свежими. Секунды, а не минуты: справочник людей
// меняется руками, и лишний фоновый запрос дешевле устаревшего экрана.
const FRESH_MS = 20_000;

const created: { reset: () => void }[] = [];
let watchingAuth = false;
let knownUser: string | null | undefined;

// Кэш живёт ровно до смены входа. Иначе второй человек, вошедший в том же
// окне, увидел бы на экране чужой список — данные общие для вкладки, а не
// для учётной записи.
function watchAuth() {
  if (watchingAuth || typeof window === "undefined") return;
  watchingAuth = true;
  createClient().auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id ?? null;
    if (knownUser !== undefined && uid !== knownUser) for (const store of created) store.reset();
    knownUser = uid;
  });
}

export function createSharedStore<T>(empty: T, load: () => Promise<T | null>): SharedStore<T> {
  // Один и тот же объект, пока данных нет: useSyncExternalStore сравнивает
  // снимки по ссылке и зациклится на функции, которая каждый раз возвращает
  // новый пустой массив.
  const idle: Snapshot<T> = { data: empty, loaded: false };
  let snapshot: Snapshot<T> = idle;
  let loadedAt = 0;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const fn of [...listeners]) fn();
  }

  function refresh(): Promise<void> {
    // Пять окон, открытых разом, спрашивают один и тот же список — и должны
    // получить один запрос на всех.
    if (inFlight) return inFlight;
    inFlight = load()
      .then((next) => {
        // Ошибку не показываем пустым списком: «не ответило» — это не
        // «никого нет». Прежние данные остаются, отметка «загружено»
        // ставится, чтобы экран не завис на «Загрузка…».
        snapshot = { data: next ?? snapshot.data, loaded: true };
        loadedAt = Date.now();
        emit();
      })
      .catch(() => {
        snapshot = { data: snapshot.data, loaded: true };
        emit();
      })
      .then(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const store: SharedStore<T> = {
    snapshot: () => snapshot,
    serverSnapshot: () => idle,
    subscribe(fn) {
      watchAuth();
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    update(change) {
      // Время загрузки намеренно не трогаем: локальная правка не делает
      // данные свежими, и следующий `ensure` всё равно сходит за правдой.
      snapshot = { data: change(snapshot.data), loaded: true };
      emit();
    },
    ensure() {
      if (!snapshot.loaded || Date.now() - loadedAt > FRESH_MS) void refresh();
    },
    refresh,
  };

  created.push({
    reset() {
      snapshot = idle;
      loadedAt = 0;
      emit();
    },
  });

  return store;
}
