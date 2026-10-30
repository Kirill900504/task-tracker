"use client";

import { useEffect } from "react";
import { SERVER_UNREACHABLE_EVENT, setServerUnreachable } from "@/lib/outbox";
import { cacheShell } from "@/lib/shellCache";
import { saveSnapshot } from "@/lib/bootSnapshot";

// Открытое окно узнаёт о новой версии и перезагружается само.
//
// 07.10.2026: запрет встреч в прошедшем времени был на сайте с 12:00, а в
// 12:13 встречу на 11:00 создали из окна, открытого утром, — и Кирилл
// написал «по-прежнему позволяет». С его стороны это так и выглядит:
// починка есть, а окно о ней не знает, пока его не перезагрузят руками. А в
// установленном приложении и в окне на ПК перезагрузку никто не делает
// вовсе — их держат открытыми днями.
//
// Поэтому окно спрашивает номер версии (/api/version) при возвращении к
// нему и раз в пять минут. Перезагрузка — только в безопасный момент: не
// открыто ни одного окна (<dialog open> — там могут заполнять форму) и
// фокус не в поле ввода. Иначе проверка повторится позже. Работа, не
// дошедшая до облака, переживает перезагрузку: движок синхронизации держит
// её в IndexedDB и досылает при старте (useTrackerData).
//
// И тот же вопрос отвечает на второй: ДОСТАЁТ ЛИ окно до своего сервера.
// 21.10.2026 выяснилось, что у Евгения Макарова трекер две недели жил на
// коде начала октября, а каждый его «Сделал» отвечал «Failed to fetch»:
// страница и её файлы приходят из кэша воркера, задачи и чат — напрямую
// из Supabase, а до самого сайта (`*.vercel.app`, его режут по имени
// многие российские сети — см. CLAUDE.md) из его сети не доходит ничего.
// Снаружи это выглядит как работающий трекер, у которого «зависают»
// кнопки: читать можно, писать в чат можно, а ответы, приёмка и
// обновления не уходят. Сказать об этом может только само окно, поэтому
// после двух неудач подряд при живой сети это становится известно
// очереди ответов (lib/outbox), а она показывает значок в шапке рядом с
// числом ждущих ответов (ConnectionStatus). Снимает его первый же
// удачный ответ — и он же отправляет накопленное.
//
// Красной плашки поверх трекера больше нет (21.10.2026): с очередью
// ответы без связи не теряются, а уходят сами, и пугать человека нечем —
// по тому же правилу «нет связи» с 24.09.2026 живёт значком.
const BUILT = process.env.NEXT_PUBLIC_RELEASE || "";
const EVERY_MS = 5 * 60_000;
// Пока значок стоит, проверяем чаще: человек переключил сеть — и через
// полминуты должен увидеть, что помогло.
const RETRY_MS = 30_000;

function busy(): boolean {
  if (document.querySelector("dialog[open]")) return true;
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

export default function VersionWatch() {
  useEffect(() => {
    const local = !BUILT || BUILT === "локальная сборка";
    let stale = false;
    let stopped = false;
    let misses = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      if (stopped || !navigator.onLine) return;
      if (!stale) {
        try {
          const res = await fetch("/api/version", { cache: "no-store" });
          const body = (await res.json()) as { release?: string };
          misses = 0;
          setServerUnreachable(false);
          // Локальная сборка номера не имеет — сравнивать не с чем.
          stale = !local && !!body.release && body.release !== BUILT;
        } catch {
          misses += 1;
          if (misses >= 2) setServerUnreachable(true);
          if (retry) clearTimeout(retry);
          retry = setTimeout(() => void check(), RETRY_MS);
          return;
        }
      }
      if (stale && !busy()) await reloadIntoNewBuild();
    }

    // Перезагрузка, которую не видно (30.10.2026, «появляется это окно
    // прогрузки данных… сделать так, чтобы его не было видно»).
    //
    // Сперва свежая страница кладётся в кэш воркера: он отдаёт «/» из кэша
    // ПЕРВЫМ (public/sw.js), а там лежала копия прежней сборки. Без этого
    // перезагрузка открывала тот же старый код, он снова видел «устарел»
    // — и окно перезагружалось второй раз подряд, оба раза через каркас.
    // Затем — снимок нынешнего экрана: на нём новая сборка и откроется
    // (lib/bootSnapshot), пока за ним не встанет настоящий трекер.
    let reloading = false;
    async function reloadIntoNewBuild() {
      if (reloading) return;
      reloading = true;
      await Promise.race([cacheShell(), new Promise((r) => setTimeout(r, 8000))]);
      if (busy()) {
        reloading = false;
        return;
      }
      saveSnapshot();
      window.location.reload();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    // Кнопка не дошла до сервера — проверяем сразу, а не через пять минут:
    // значок должен встать рядом с отказом, пока человек на него смотрит.
    const onUnreachable = () => {
      misses = Math.max(misses, 1);
      void check();
    };
    const timer = setInterval(() => void check(), EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener(SERVER_UNREACHABLE_EVENT, onUnreachable);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      if (retry) clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener(SERVER_UNREACHABLE_EVENT, onUnreachable);
    };
  }, []);

  return null;
}
