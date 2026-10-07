"use client";

import { useEffect } from "react";

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
const BUILT = process.env.NEXT_PUBLIC_RELEASE || "";
const EVERY_MS = 5 * 60_000;

function busy(): boolean {
  if (document.querySelector("dialog[open]")) return true;
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

export default function VersionWatch() {
  useEffect(() => {
    // Локальная сборка номера не имеет — сравнивать не с чем.
    if (!BUILT || BUILT === "локальная сборка") return;
    let stale = false;
    let stopped = false;

    async function check() {
      if (stopped || !navigator.onLine) return;
      if (!stale) {
        try {
          const res = await fetch("/api/version", { cache: "no-store" });
          const body = (await res.json()) as { release?: string };
          stale = !!body.release && body.release !== BUILT;
        } catch {
          return;
        }
      }
      if (stale && !busy()) window.location.reload();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = setInterval(() => void check(), EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
