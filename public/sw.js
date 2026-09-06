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
const CACHE = "rokas-shell-v2";
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
    // A redirected response cannot be cached for a navigation (the browser
    // refuses it), and a redirect here means the sign-in page anyway.
    if (response && response.ok && !response.redirected) cache.put(fallbackUrl || request, response.clone());
    return response;
  } catch (err) {
    // ignoreVary: Next serves the document with a Vary header (RSC and
    // friends), and a reload never sends exactly the same header set — a
    // strict match would miss the shell that is sitting right there.
    const cached = await cache.match(fallbackUrl || request, { ignoreVary: true, ignoreSearch: true });
    // A redirected response cannot answer a navigation — treat it as a miss
    // rather than handing the browser something it will reject outright.
    if (cached && !cached.redirected) return cached;
    throw err;
  }
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
