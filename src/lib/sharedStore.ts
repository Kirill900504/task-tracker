"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { onRevive } from "@/lib/revive";

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

// Сколько данные считаются свежими — то есть только сколько длится один
// всплеск монтирований. Открытое окно всё равно перечитает список фоном,
// показав при этом уже известное: кэш здесь ускоряет показ, а не заменяет
// правду. Больше этого ставить нельзя — на 20 секундах человек, нажавший
// «Start» в боте, ещё полминуты числился бы неподключённым.
const FRESH_MS = 2_000;

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

// Справочник с прошлого запуска — первым кадром (22.10.2026, снимок Кирилла:
// при открытии у каждой мысли одна кнопка «Создать», а через секунду рядом
// встают «Отправить» и «Поделиться»). Кнопки ждали список команды из сети, а
// жил он только в памяти вкладки, то есть каждый запуск начинался с пустого.
// Теперь ответ лежит в localStorage под своим auth-id (его пишет
// useWorkspaceRole — тот же приём, что у роли и участия) и отдаётся сразу;
// сеть догоняет и заменяет его, потому что `loadedAt` у кэша нулевой и первый
// же `ensure` идёт за правдой. Чужой auth-id — кэша нет: на общем компьютере
// второй вошедший не должен увидеть чужую команду даже на секунду.
function myUserId(): string {
  try {
    const raw = localStorage.getItem("kkt_identity");
    return raw ? JSON.parse(raw).userId || "" : "";
  } catch {
    return "";
  }
}

function readPersisted<T>(key: string): T | undefined {
  const uid = myUserId();
  if (!uid) return undefined;
  try {
    const raw = localStorage.getItem("kkt_store_" + key);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { userId: string; data: T };
    return saved.userId === uid ? saved.data : undefined;
  } catch {
    return undefined;
  }
}

function writePersisted<T>(key: string, data: T) {
  const uid = myUserId();
  if (!uid) return;
  try {
    localStorage.setItem("kkt_store_" + key, JSON.stringify({ userId: uid, data }));
  } catch {
    /* переполнилось или приватный режим — следующий старт просто пойдёт в сеть */
  }
}

// `watch` — таблицы, изменение которых означает, что список устарел. Это и
// есть настоящий ответ на «а вдруг данные протухли»: человек, нажавший
// «Start» в боте, должен появиться подключённым во всех открытых окнах сразу,
// как появляется всё остальное в трекере. Срок годности выше — только чтобы
// не спрашивать одно и то же по десять раз на одной отрисовке.
// `persist` — имя, под которым список переживает перезапуск (см. выше).
export function createSharedStore<T>(
  empty: T,
  load: () => Promise<T | null>,
  watch: string[] = [],
  persist?: string,
): SharedStore<T> {
  // Один и тот же объект, пока данных нет: useSyncExternalStore сравнивает
  // снимки по ссылке и зациклится на функции, которая каждый раз возвращает
  // новый пустой массив.
  const idle: Snapshot<T> = { data: empty, loaded: false };
  let snapshot: Snapshot<T> = idle;
  // Кэш читается при первом обращении в браузере, а не при загрузке модуля:
  // модуль исполняется и на сервере, где localStorage нет.
  let hydrated = !persist;
  function hydrate() {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    const saved = readPersisted<T>(persist!);
    if (saved !== undefined && !snapshot.loaded) snapshot = { data: saved, loaded: true };
  }
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
        if (persist && next != null) writePersisted(persist, next);
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

  // Канал живёт, только пока на список кто-то смотрит: держать сокет ради
  // окна, которое закрыли, незачем.
  let channel: RealtimeChannel | null = null;
  let stopRevive: (() => void) | null = null;

  function listen() {
    if (channel || !watch.length || typeof window === "undefined") return;
    // Подписка умирает молча (см. lib/revive.ts), и справочник после этого
    // остаётся вчерашним: человек, подключивший бота, в открытых окнах так
    // и числится неподключённым. Поэтому у списка есть и второй путь к
    // правде — поводы перечитать.
    stopRevive ||= onRevive(() => void refresh());
    const db = createClient();
    const ch = db.channel(`shared-${watch.join("-")}`);
    for (const table of watch) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        void refresh();
      });
    }
    // Подъём канала — повод перечитать: пока он поднимался, события не
    // приходили, а догонять пропущенное realtime не умеет.
    channel = ch.subscribe((status) => {
      if (status === "SUBSCRIBED") void refresh();
    });
  }

  function stopListening() {
    stopRevive?.();
    stopRevive = null;
    if (!channel) return;
    void createClient().removeChannel(channel);
    channel = null;
  }

  const store: SharedStore<T> = {
    snapshot: () => {
      hydrate();
      return snapshot;
    },
    serverSnapshot: () => idle,
    subscribe(fn) {
      watchAuth();
      listeners.add(fn);
      listen();
      return () => {
        listeners.delete(fn);
        if (!listeners.size) stopListening();
      };
    },
    update(change) {
      // Время загрузки намеренно не трогаем: локальная правка не делает
      // данные свежими, и следующий `ensure` всё равно сходит за правдой.
      snapshot = { data: change(snapshot.data), loaded: true };
      emit();
    },
    ensure() {
      hydrate();
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
