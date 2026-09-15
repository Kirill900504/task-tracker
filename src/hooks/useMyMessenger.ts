"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMaxBot } from "@/hooks/useMaxBot";
import type { ColleagueChannel } from "@/hooks/useColleagues";

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

export type MessengerState = {
  loading: boolean;
  telegram: { connected: boolean; username: string };
  max: { connected: boolean; username: string; available: boolean };
  // Ссылка и код на один экран — см. комментарий в ManagerScreen о том,
  // почему одной ссылки мало.
  connect: (channel: ColleagueChannel) => Promise<ConnectResult>;
  refresh: () => void;
};

export function useMyMessenger(assigneeId: string): MessengerState {
  const [state, setState] = useState({
    loading: true,
    tg: { connected: false, username: "" },
    mx: { connected: false, username: "" },
  });
  const maxBot = useMaxBot();

  useEffect(() => {
    if (!assigneeId) return;
    let cancelled = false;
    const db = createClient();

    async function read() {
      const { data, error } = await db
        .from("assignees")
        .select("telegram_chat_id, telegram_username, max_user_id, max_username")
        .eq("id", assigneeId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as {
        telegram_chat_id: number | null;
        telegram_username: string | null;
        max_user_id: number | null;
        max_username: string | null;
      } | null;
      // Ошибку глотаем: «не смогли прочитать» — не то же самое, что «не
      // подключён», и показывать кнопку подключения из-за сбоя сети значит
      // предлагать человеку чинить то, что не сломано.
      if (error) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      setState({
        loading: false,
        tg: { connected: row?.telegram_chat_id != null, username: row?.telegram_username || "" },
        mx: { connected: row?.max_user_id != null, username: row?.max_username || "" },
      });
    }

    void read();

    // Подключение происходит не здесь, а в мессенджере: человек уходит,
    // жмёт «Начать» и возвращается на эту же вкладку. Перечитать при
    // возвращении — единственный способ показать ему результат без
    // требования обновить страницу.
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [assigneeId]);

  const refresh = useCallback(() => {
    // Тот же путь, что и при возвращении на вкладку: кнопка «Проверить»
    // нужна там, где встроенный браузер мессенджера события focus не даёт.
    window.dispatchEvent(new Event("focus"));
  }, []);

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
