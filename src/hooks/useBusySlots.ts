"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSharedStore } from "@/lib/sharedStore";
import type { Meeting } from "@/types/tracker";

// Кто занят и когда — по встречам, которых я не вижу.
//
// Запрет двух встреч на одно время с одним человеком (07.10.2026) считался
// по встречам, загруженным в браузер. С миграцией 0057 каждый, владелец
// тоже, получает из базы только свои встречи и те, куда позван, — и проверка
// перестала бы замечать, что Игорь в 15:00 уже сидит у Станислава. У
// руководителей она этого не замечала никогда.
//
// Содержимое чужих встреч браузеру не нужно и не отдаётся: функция базы
// `busy_slots` возвращает только «кто, в какой день, с какого часа, сколько
// минут» — без названия, итога и номера встречи. Здесь из этого собираются
// встречи-заглушки ровно той формы, которую понимает `busyPeople`: одна на
// человека, с выдуманным id, которого никто не откроет. В списки встреч
// они не попадают — только в `allMeetings`, который читает проверка.

type Slot = { person: string; date: string; time: string; duration_min: number | null };

async function fetchSlots(): Promise<Slot[] | null> {
  const { data, error } = await createClient().rpc("busy_slots");
  // Отказ — пустой список, а не поломка: до применения миграции функции нет,
  // и форма должна работать по тем встречам, что у неё есть.
  if (error) return [];
  return (data || []) as Slot[];
}

const store = createSharedStore<Slot[]>([], fetchSlots, ["meetings", "meeting_participants"]);

export function useBusySlots(): Meeting[] {
  const { data } = useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);

  useEffect(() => {
    store.ensure();
  }, []);

  return useMemo(
    () =>
      data.map(
        (s, i): Meeting => ({
          id: `busy:${i}`,
          date: String(s.date).slice(0, 10),
          time: s.time || "",
          durationMin: s.duration_min ?? undefined,
          title: "",
          participants: [s.person],
          status: "planned",
          result: "",
          movedToDate: "",
          resolvedAt: "",
        }),
      ),
    [data],
  );
}
