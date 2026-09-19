"use client";

// Отправить сообщение о поломке. Из браузера, один раз, ничего не ломая по
// дороге.
//
// Всё здесь — про то, чтобы сообщение об ошибке само не стало ошибкой:
// падение случается в худшую минуту жизни страницы, и отправка не должна ни
// падать, ни ждать, ни повторяться.

const sent = new Set<string>();

export function reportCrash(error: unknown, extra?: { where?: string }) {
  if (typeof window === "undefined") return;

  const err = error instanceof Error ? error : new Error(String(error));
  const message = (extra?.where ? extra.where + ": " : "") + (err.message || "неизвестная ошибка");

  // Одно и то же — один раз за жизнь вкладки. Цикл отрисовки способен
  // позвать это тысячу раз подряд, и предел на стороне сервера тогда
  // отсечёт как раз то, что придёт первым.
  const key = message.slice(0, 200);
  if (sent.has(key)) return;
  sent.add(key);

  const body = JSON.stringify({
    message,
    stack: err.stack || "",
    url: window.location.href,
    release: process.env.NEXT_PUBLIC_RELEASE || "",
  });

  try {
    // sendBeacon переживает закрытие вкладки и не ждёт ответа — а закрыть
    // сломанную страницу человек может в любую секунду. Обычный fetch
    // остаётся запасным путём: beacon есть не везде и молча отказывает,
    // когда тело крупнее его лимита.
    const beacon = navigator.sendBeacon?.bind(navigator);
    if (beacon && beacon("/api/client-error", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* сообщение о поломке, уронившее страницу второй раз, — это худшее из возможного */
  }
}
