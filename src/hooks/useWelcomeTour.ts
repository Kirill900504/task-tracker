"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { shouldShowTour } from "@/lib/welcomeTour";

// Когда показать стартовое знакомство (правило — lib/welcomeTour) и как
// запомнить, что его прошли.
//
// Отметка — в метаданных учётной записи (`tour_done`), а не в браузере:
// человек открывает трекер и на телефоне, и на ПК, и второй раз то же
// знакомство на другом устройстве — уже навязчивость. Копия в localStorage
// — только чтобы окно не всплыло снова в ту секунду, пока запись едет.
//
// Сессия читается из браузера (getSession), без запроса в сеть: на пути к
// первому кадру сетевого ответа быть не должно.

const LOCAL_KEY = "kkt_tour_done";

export function useWelcomeTour(enabled: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const user = data.session?.user;
        if (!alive || !user) return;
        let localDone = false;
        try {
          localDone = localStorage.getItem(`${LOCAL_KEY}_${user.id}`) === "1";
        } catch {
          // Приватный режим — полагаемся на учётную запись.
        }
        const show = shouldShowTour({
          createdAt: user.created_at,
          done: localDone || user.user_metadata?.tour_done === true,
          now: Date.now(),
          automated: typeof navigator !== "undefined" && navigator.webdriver === true,
        });
        if (show) setOpen(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  function close() {
    setOpen(false);
    const db = createClient();
    void db.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id;
      if (!id) return;
      try {
        localStorage.setItem(`${LOCAL_KEY}_${id}`, "1");
      } catch {
        /* приватный режим */
      }
      void db.auth.updateUser({ data: { tour_done: true } });
    });
  }

  return { open, show: () => setOpen(true), close };
}
