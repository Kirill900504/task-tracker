"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TOUR_VERSION, seenTourVersion, shouldShowTour } from "@/lib/welcomeTour";

// Когда показать стартовое знакомство (правило — lib/welcomeTour) и как
// запомнить, что его прошли.
//
// Отметка — номер версии в метаданных учётной записи (`tour_version`), а не в браузере:
// человек открывает трекер и на телефоне, и на ПК, и второй раз то же
// знакомство на другом устройстве — уже навязчивость. Копия в localStorage
// — только чтобы окно не всплыло снова в ту секунду, пока запись едет.
//
// Решение спрашивает учётную запись у сервера (getUser), а не у сессии в
// браузере: метаданные в сессии — копия из токена, и на втором устройстве
// она до часа помнит «не видел», то есть показала бы знакомство дважды. На
// первый кадр это не влияет — окно всплывает поверх уже открытого трекера.

// Ключ несёт версию: отметка «видел первую» не должна прятать вторую.
const LOCAL_KEY = `kkt_tour_v${TOUR_VERSION}`;

export function useWelcomeTour(enabled: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const user = data.user;
        if (!alive || !user) return;
        let localDone = false;
        try {
          localDone = localStorage.getItem(`${LOCAL_KEY}_${user.id}`) === "1";
        } catch {
          // Приватный режим — полагаемся на учётную запись.
        }
        const show = shouldShowTour({
          seenVersion: localDone ? TOUR_VERSION : seenTourVersion(user.user_metadata),
          automated: typeof navigator !== "undefined" && navigator.webdriver === true,
        });
        if (show) setOpen(true);
      })
      // Без связи знакомство просто подождёт следующего открытия.
      .catch(() => {});
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
      void db.auth.updateUser({ data: { tour_done: true, tour_version: TOUR_VERSION } });
    });
  }

  return { open, show: () => setOpen(true), close };
}
