"use client";

import { useEffect, useState } from "react";
import { me } from "@/lib/me";

// «Мои данные» — второй шаг, а не часть подключения (28.10.2026, его слова:
// «сделай возможность всем внести свою почту рабочую, телефон и поставить
// свой пароль… если не при регистрации, так потом, вторым этапом»).
//
// Подключение остаётся одним нажатием «Start» в боте. А когда человек уже
// внутри и почты или телефона у него нет, на имени в шапке стоит отметка
// до заполнения, а пришедшему через бота (почты нет вовсе) трекер ОДИН раз
// на этом устройстве сам открывает личный кабинет (`onFirstAsk`). Не плашка поверх доски: такие он снимал
// («всплывающие окна мне не нравятся и засоряют место»), а не спрашивать
// вовсе — значит, что до этого никто не доберётся.
//
// Ответ сети здесь не на пути к первому кадру: шапка рисуется без отметки,
// отметка доезжает, когда придёт ответ.

const askedKey = (id: string) => `kkt_profile_asked_${id}`;

export function useProfileStatus(enabled: boolean, onFirstAsk: () => void) {
  const [incomplete, setIncomplete] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      const res = await fetch("/api/account/credentials").catch(() => null);
      const data = (await res?.json().catch(() => null)) as { complete?: boolean; email?: string } | null;
      if (!alive || !res?.ok || !data || data.complete !== false) return;
      setIncomplete(true);
      // Сам кабинет открывается только тому, кто пришёл через бота и почты
      // у него нет вовсе: это и есть «второй этап». Кто уже задал почту
      // (приглашён по почте, владелец), тому хватит отметки на имени —
      // открывать ему окно поверх доски незачем.
      if (data.email) return;
      const id = (await me()).userId;
      if (!alive || !id) return;
      try {
        if (localStorage.getItem(askedKey(id))) return;
        localStorage.setItem(askedKey(id), new Date().toISOString());
      } catch {
        // Хранилище закрыто — лучше не спрашивать, чем спрашивать на
        // каждом входе.
        return;
      }
      onFirstAsk();
    })();
    return () => {
      alive = false;
    };
    // onFirstAsk — новый на каждой перерисовке; спросить нужно один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { incomplete, setComplete: (complete: boolean) => setIncomplete(!complete) };
}
