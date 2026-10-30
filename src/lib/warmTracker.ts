// Файлы трекера качаются, пока человек на странице входа (30.10.2026, «опять
// после входа прогружается долго!!!»).
//
// Замер на боевом: от «Войти» до живого трекера 5,7 с, и 2,8 из них уходили
// на то, чтобы ТОЛЬКО ПОСЛЕ входа начать качать файлы главной страницы. Пока
// человек набирает пароль (или подтверждает вход в мессенджере), сеть
// простаивает — значит качать надо тогда.
//
// Встроенная предзагрузка Next (`router.prefetch`) здесь не работает: её
// запрос без сессии прослойка уводит на /login, а отличить его от обычного
// она не может — Next стирает его заголовки до прослойки. Поэтому оболочка
// «/» спрашивается со своим знаком (`?warm=1`, пропускается прослойкой без
// сессии: это каркас без единой строки данных), из неё берутся адреса
// файлов, и каждый скачивается один раз. Дальше их отдают кэш браузера (они
// неизменяемые) и воркер (`/_next/static` — сначала кэш, public/sw.js).
export const WARM_PARAM = "warm";

export function assetUrls(html: string): string[] {
  const found = html.match(/\/_next\/static\/[^"'\s\\)]+\.(?:js|css)/g) ?? [];
  return [...new Set(found)];
}

let started = false;

export function warmTracker(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void (async () => {
    try {
      const res = await fetch(`/?${WARM_PARAM}=1`, { credentials: "same-origin" });
      if (!res.ok || res.redirected) return;
      // Не все разом и не впереди того, что нужно странице входа сейчас.
      await Promise.all(assetUrls(await res.text()).map((u) => fetch(u, { priority: "low" } as RequestInit).catch(() => {})));
    } catch {
      /* без связи прогревать нечего — вход и так скажет об этом */
    }
  })();
}
