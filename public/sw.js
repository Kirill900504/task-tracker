// Service worker: makes the tracker open without a connection.
//
// It caches the application shell only — the HTML document and the hashed
// build assets under /_next/static. The data itself never goes through here:
// it lives in IndexedDB (see src/lib/offlineStore.ts), written by the app,
// which is also what knows which changes are still unsent. A cached API
// response would be a second, competing copy of the truth with no way to
// tell either of those things.
//
// Requests to Supabase (another origin), anything that is not a GET, and
// anything under /api are passed straight to the network, always.

// Bumped whenever what gets cached changes shape: activate() drops every
// other cache, which is the only way to be rid of a bad entry an older
// version stored.
const CACHE = "rokas-shell-v3";
// Deliberately without "/": at install time nobody is signed in yet, so
// fetching it returns a redirect to /login — and a redirected response can
// never be used to answer a navigation (the browser refuses it, and the
// page fails to open at all). The application shell is put into this same
// cache by the page itself, on every load — see src/app/registerSW.ts for
// why it has to be the page and not this worker.
const SHELL = ["/favicon.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll fails the whole install if any single entry 404s; each is
      // added on its own so a missing icon cannot cost us the shell.
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Network first, cache as the fallback: online, the page must always be the
// freshly deployed one — a stale shell served from cache is how a PWA ends
// up running last week's build. The cache is only ever the answer when the
// network has actually failed.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // fetch() follows the redirect itself and hands back a response whose
    // `redirected` flag makes the browser REFUSE it as the answer to a
    // navigation. The installed app then shows its own blank failure page,
    // and so does every attempt after it: there is no address bar in a
    // standalone window, so the app is simply dead from then on.
    //
    // This is not a corner case. "/" redirects to /login the moment the
    // session expires, which happens to every installed app eventually —
    // and it is exactly what happened on 19.09.2026, when the app stopped
    // opening while the same address in a browser worked fine (the browser
    // had no worker registered, so nothing intercepted the navigation).
    // The rule was already known and written down twice in this file; it
    // was applied to what gets CACHED and to what gets served from cache,
    // and not to the live response on its way back. Send the browser to
    // where the fetch actually landed instead, as a real redirect it knows
    // how to follow: /login answers 200 on its own, so there is no loop.
    if (response && response.redirected && response.url && response.url !== request.url) {
      return Response.redirect(response.url, 302);
    }
    // Only the tracker itself is the shell. A navigation that ended up on
    // the sign-in page must not be stored as the offline copy of "/", or
    // the app opens without a connection on a form it cannot submit.
    const landed = response && response.url ? new URL(response.url).pathname : "";
    if (response && response.ok && !response.redirected && (!fallbackUrl || landed === fallbackUrl)) {
      cache.put(fallbackUrl || request, response.clone());
    }
    return response;
  } catch (err) {
    // ignoreVary: Next serves the document with a Vary header (RSC and
    // friends), and a reload never sends exactly the same header set — a
    // strict match would miss the shell that is sitting right there.
    const cached = await cache.match(fallbackUrl || request, { ignoreVary: true, ignoreSearch: true });
    // A redirected response cannot answer a navigation — treat it as a miss
    // rather than handing the browser something it will reject outright.
    if (cached && !cached.redirected) return cached;
    // Last resort. The browser's own failure page is in English, says
    // nothing about what happened, and in a standalone window there is not
    // even an address bar to retype — «не открывается» is all it can mean
    // to the person looking at it. Answer with something that says which of
    // the two it is and offers the one button that helps.
    if (request.mode === "navigate") return offlinePage();
    throw err;
  }
}

// Served only when the network failed AND nothing is cached — that is, on a
// first run without a connection. Deliberately one self-contained file: it
// has to render when nothing else can be fetched.
function offlinePage() {
  const html =
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Нет связи</title><style>" +
    "html,body{height:100%;margin:0}" +
    "body{background:#232B2E;color:#E6ECEF;display:flex;align-items:center;justify-content:center;" +
    "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px}" +
    "h1{font-size:20px;font-weight:700;margin:0 0 10px}" +
    "p{font-size:15px;line-height:1.5;margin:0 0 20px;color:#A9B6BC;max-width:340px}" +
    "button{font:inherit;font-size:15px;padding:11px 22px;min-height:44px;border:0;border-radius:10px;" +
    "background:#4A9BC4;color:#fff;cursor:pointer}" +
    "</style></head><body><div>" +
    "<h1>Нет связи</h1>" +
    "<p>Трекер не открылся: интернет сейчас недоступен. Данные на месте — как только связь появится, всё откроется как обычно.</p>" +
    '<button onclick="location.reload()">Попробовать снова</button>' +
    "</div></body></html>";
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Build assets are content-hashed, so a hit is always the right file and can
// be served without asking the network at all.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Every route falls back to "/" — the tracker is one page, and the login
    // page is useless offline anyway.
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  // Only the plain asset URLs — Next's RSC requests share the page's path
  // and differ by query string, and they are data, not shell.
  if (url.pathname.startsWith("/_next/static/") || (url.search === "" && SHELL.includes(url.pathname))) {
    event.respondWith(cacheFirst(request));
  }
});
