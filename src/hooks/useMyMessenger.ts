"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMaxBot } from "@/hooks/useMaxBot";
import type { ColleagueChannel } from "@/hooks/useColleagues";
import type { LinkedNow } from "@/lib/messengerLink";
import { humanError, isNetworkError } from "@/lib/humanError";

// Свой мессенджер глазами руководителя.
//
// У владельца для этого есть useBotLink, и он спрашивает telegram_accounts —
// таблицу «чат хозяина трекера». У руководителя чат живёт в другом месте: в
// его собственной строке assignees, потому что именно туда бот шлёт задачи и
// кнопки «Принял / Сделал». Две разные привязки, и перепутать их нельзя —
// человек, подключившийся «как владелец», получил бы пустой трекер вместо
// своих задач.
//
// Раньше подключить себя руководитель не мог вовсе: ссылку выдавал только
// Кирилл из «Команды». Сменил телефон — иди к Кириллу. Это ровно тот ответ,
// который в этом проекте считается плохим.

export type ConnectResult = { ok: true; link: string; code: string } | { ok: false; error: string };

// Что показала проверка (тип — в lib/messengerLink вместе с правилами,
// которые по нему решают, что показывать). Кнопке «Готово, проверить» мало
// перечитать строку: человек нажал её именно затем, чтобы услышать ответ, и
// ответ должен вернуться туда, где он нажал.
export type { LinkedNow };

export type MessengerState = {
  loading: boolean;
  telegram: { connected: boolean; username: string };
  max: { connected: boolean; username: string; available: boolean };
  // Ссылка и код на один экран — см. комментарий в MessengerLink о том,
  // почему одной ссылки мало.
  connect: (channel: ColleagueChannel) => Promise<ConnectResult>;
  refresh: () => Promise<LinkedNow>;
  // Ссылка и код, выписанные ЗАРАНЕЕ, — по каналу, который ещё не
  // подключён. Кнопка «Подключить» с ними — обычная ссылка, которой в
  // момент нажатия сервер не нужен вовсе (см. PREPARED_KEY).
  prepared: Partial<Record<ColleagueChannel, { link: string; code: string }>>;
};

// Выписанный код лежит в браузере до истечения.
//
// 13.10.2026 Юрий Нодберг снова не смог подключиться сам: ни одна из двух
// кнопок не сработала, обе ответили «Нет связи с сервером трекера», и
// подключился он только ссылкой, которую Кирилл выдал из «Команды». Запрос
// за кодом шёл В МОМЕНТ НАЖАТИЯ — то есть ровно тогда, когда телефон в
// дороге, сеть моргает, а вкладка, открытая из кэша, ещё не проснулась.
// Повтор через секунду (добавлен после первого такого случая 25.09) этого
// не лечит. Теперь код просится, как только трекер открылся и понял, что
// мессенджера нет, и запоминается здесь; нажатие уже ничего не спрашивает.
// Код живёт трое суток на сервере (api/telegram/invite) — здесь меньше,
// чтобы ссылка не умерла у человека в руках.
const PREPARED_KEY = (assigneeId: string, channel: ColleagueChannel) => `rokas:ms-code:${assigneeId}:${channel}`;
const PREPARED_TTL_MS = 2 * 24 * 60 * 60 * 1000;

function readPrepared(assigneeId: string, channel: ColleagueChannel): { link: string; code: string } | null {
  try {
    const raw = localStorage.getItem(PREPARED_KEY(assigneeId, channel));
    if (!raw) return null;
    const value = JSON.parse(raw) as { link?: string; code?: string; until?: number };
    if (!value.link || !value.code || !value.until || value.until < Date.now()) return null;
    return { link: value.link, code: value.code };
  } catch {
    return null;
  }
}

function writePrepared(assigneeId: string, channel: ColleagueChannel, value: { link: string; code: string } | null) {
  try {
    if (value) localStorage.setItem(PREPARED_KEY(assigneeId, channel), JSON.stringify({ ...value, until: Date.now() + PREPARED_TTL_MS }));
    else localStorage.removeItem(PREPARED_KEY(assigneeId, channel));
  } catch {
    /* хранилище закрыто — тогда просто без запаса, как раньше */
  }
}

// Чтение отдельно от состояния: строку читает функция вне хука, а в React
// её результат кладёт `apply`. Это не стиль, а требование — правило
// react-hooks/set-state-in-effect запрещает эффекту звать что-либо, что
// внутри себя делает setState, зато позволяет сделать это в колбэке
// пришедшего ответа, чем оно и является.
type LinkRow = {
  telegram_chat_id: number | null;
  telegram_username: string | null;
  max_user_id: number | null;
  max_username: string | null;
};

async function readLink(assigneeId: string): Promise<{ ok: boolean; row: LinkRow | null }> {
  const db = createClient();
  const { data, error } = await db
    .from("assignees")
    .select("telegram_chat_id, telegram_username, max_user_id, max_username")
    .eq("id", assigneeId)
    .maybeSingle();
  // Ошибку глотаем: «не смогли прочитать» — не то же самое, что «не
  // подключён», и показывать кнопку подключения из-за сбоя сети значит
  // предлагать человеку чинить то, что не сломано.
  return { ok: !error, row: (data as LinkRow | null) ?? null };
}

export function useMyMessenger(assigneeId: string): MessengerState {
  const [state, setState] = useState({
    loading: true,
    tg: { connected: false, username: "" },
    mx: { connected: false, username: "" },
  });
  const maxBot = useMaxBot();

  const apply = useCallback((result: { ok: boolean; row: LinkRow | null }): LinkedNow => {
    if (!result.ok) {
      setState((s) => ({ ...s, loading: false }));
      return { telegram: false, max: false };
    }
    const row = result.row;
    const next = {
      loading: false,
      tg: { connected: row?.telegram_chat_id != null, username: row?.telegram_username || "" },
      mx: { connected: row?.max_user_id != null, username: row?.max_username || "" },
    };
    setState(next);
    return { telegram: next.tg.connected, max: next.mx.connected };
  }, []);

  // Перечитать строку и ВЕРНУТЬ, что в ней теперь стоит. Возвращаемое
  // значение — вся разница между кнопкой и пустым местом: раньше «проверить»
  // означало разослать по окну событие focus и понадеяться, что кто-нибудь
  // его услышит, а нажавший не узнавал ни что проверка идёт, ни чем она
  // кончилась. Если он уже был подключён — на экране и так ничего не
  // менялось, и кнопка выглядела сломанной. Ею и была.
  const refresh = useCallback(async (): Promise<LinkedNow> => {
    if (!assigneeId) return { telegram: false, max: false };
    return apply(await readLink(assigneeId));
  }, [assigneeId, apply]);

  useEffect(() => {
    if (!assigneeId) return;
    let alive = true;
    // Подключение происходит не здесь, а в мессенджере: человек уходит,
    // жмёт «Начать» и возвращается на эту же вкладку. Перечитать при
    // возвращении — единственный способ показать ему результат без
    // требования обновить страницу.
    const run = () => {
      void readLink(assigneeId).then((result) => {
        if (alive) apply(result);
      });
    };
    run();
    window.addEventListener("focus", run);
    return () => {
      alive = false;
      window.removeEventListener("focus", run);
    };
  }, [assigneeId, apply]);

  const connect = useCallback(
    async (channel: ColleagueChannel) => {
      // Один повтор при обрыве связи. Юрий Нодберг нажал «Подключить» и
      // получил «Failed to fetch»: запрос не дошёл до сервера вовсе, на
      // мобильном интернете это обычное моргание. Повторить молча дешевле,
      // чем просить человека нажать ещё раз, — код подключения от повтора
      // не портится, выписывается просто новый.
      const send = () =>
        fetch("/api/telegram/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigneeId, channel }),
        });
      try {
        let res: Response;
        try {
          res = await send();
        } catch (first) {
          if (!isNetworkError(first)) throw first;
          await new Promise((r) => setTimeout(r, 1200));
          res = await send();
        }
        // Сессия кончилась — middleware уводит запрос на /login, и вместо
        // JSON приходит страница. Сказать это словами, а не «Unexpected token».
        if (res.redirected || !(res.headers.get("content-type") || "").includes("json")) {
          return { ok: false as const, error: "Вход в трекер истёк — обновите страницу и войдите снова." };
        }
        const data = await res.json();
        if (data.error) return { ok: false as const, error: data.error as string };
        return { ok: true as const, link: (data.link as string) || "", code: (data.code as string) || "" };
      } catch (e) {
        return { ok: false as const, error: humanError(e, "Не получилось связаться с сервером") };
      }
    },
    [assigneeId],
  );

  // Запас кода — по каждому неподключённому каналу, фоном. Из браузерной
  // памяти, если там свежий; иначе с сервера, и тогда в память. Повторяется
  // при возвращении на вкладку, пока не получится: сеть, которой не было
  // при открытии, к этому времени обычно есть.
  const [fetched, setFetched] = useState<Partial<Record<ColleagueChannel, { link: string; code: string }>>>({});
  const needTg = !state.loading && !state.tg.connected;
  const needMax = !state.loading && maxBot.available && !state.mx.connected;
  useEffect(() => {
    if (!assigneeId) return;
    let alive = true;
    const wanted: ColleagueChannel[] = [...(needTg ? ["telegram" as const] : []), ...(needMax ? ["max" as const] : [])];
    const fill = () => {
      for (const channel of wanted) {
        if (readPrepared(assigneeId, channel)) continue;
        void connect(channel).then((result) => {
          if (!alive || !result.ok || !result.link) return;
          writePrepared(assigneeId, channel, { link: result.link, code: result.code });
          setFetched((prev) => ({ ...prev, [channel]: { link: result.link, code: result.code } }));
        });
      }
    };
    fill();
    window.addEventListener("focus", fill);
    return () => {
      alive = false;
      window.removeEventListener("focus", fill);
    };
  }, [assigneeId, needTg, needMax, connect]);

  // Подключённому каналу запас не нужен — и показывать его нельзя: код уже
  // сгорел на сервере.
  const prepared: MessengerState["prepared"] = {};
  if (assigneeId && needTg) prepared.telegram = fetched.telegram ?? readPrepared(assigneeId, "telegram") ?? undefined;
  if (assigneeId && needMax) prepared.max = fetched.max ?? readPrepared(assigneeId, "max") ?? undefined;

  return {
    loading: state.loading,
    telegram: state.tg,
    max: { ...state.mx, available: maxBot.available },
    connect,
    refresh,
    prepared,
  };
}
