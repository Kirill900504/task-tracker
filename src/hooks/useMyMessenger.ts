"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMaxBot } from "@/hooks/useMaxBot";
import type { ColleagueChannel } from "@/hooks/useColleagues";
import type { LinkedNow } from "@/lib/messengerLink";

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
};

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
      try {
        const res = await fetch("/api/telegram/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigneeId, channel }),
        });
        const data = await res.json();
        if (data.error) return { ok: false as const, error: data.error as string };
        return { ok: true as const, link: (data.link as string) || "", code: (data.code as string) || "" };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : "Не получилось связаться с сервером" };
      }
    },
    [assigneeId],
  );

  return {
    loading: state.loading,
    telegram: state.tg,
    max: { ...state.mx, available: maxBot.available },
    connect,
    refresh,
  };
}
