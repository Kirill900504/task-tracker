import { createBrowserClient } from "@supabase/ssr";

// The browser talks to Supabase over its own origin whenever the direct one
// cannot be reached.
//
// Why: on a mobile network the tracker's own pages load perfectly (they come
// from our domain) while every request to <project>.supabase.co times out —
// the carrier does not carry that host. The result is a page that hydrates,
// shows "Загрузка…" and then the "нет связи с облаком" screen, on a phone
// whose connection is otherwise fine. Nothing in the app can make that host
// reachable, but it does not have to be: our own domain demonstrably is, and
// it can pass the requests on (see the /sb rewrite in next.config.ts).
//
// So: try the direct host once, and if it does not answer, send everything
// through /sb for the rest of the session. The choice is remembered, so the
// next start on the same phone does not pay for the probe again — and it is
// un-remembered as soon as the direct host answers again, so a phone that
// spends most of its life on wifi goes back to talking to Supabase directly.
//
// The realtime websocket is deliberately left pointing at the direct host:
// Vercel's rewrites do not carry websocket upgrades, so there is nothing to
// route it through. On a network that blocks Supabase it simply never
// connects, exactly as it does today — see useTrackerData's subscribeRealtime.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const PROXY_PREFIX = "/sb";
const ROUTE_KEY = "rokas-sb-route";
// Long enough for a slow-but-working mobile connection to answer a request
// this small, short enough that a blocked host does not hold up the start.
const PROBE_TIMEOUT_MS = 4000;

let routedThroughProxy = false;
let decision: Promise<boolean> | null = null;

function readRemembered(): boolean {
  try {
    return window.localStorage.getItem(ROUTE_KEY) === "proxy";
  } catch {
    return false;
  }
}

function remember(useProxy: boolean) {
  try {
    if (useProxy) window.localStorage.setItem(ROUTE_KEY, "proxy");
    else window.localStorage.removeItem(ROUTE_KEY);
  } catch {
    /* storage refused (private mode) — the probe just runs again next start */
  }
}

// "Did anything at all answer?" — not "did it answer correctly". mode:
// "no-cors" is what makes that distinction: any HTTP response resolves it
// (even a 401, even one we are not allowed to read), and only a connection
// that fails or never answers rejects. That is precisely the question here.
async function reachable(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probe(): Promise<boolean> {
  if (await reachable(`${SUPABASE_URL}/auth/v1/health`)) {
    remember(false);
    return false;
  }
  // The direct host is silent. If our own origin answers, this is that host
  // specifically — go through it. If nothing answers, the phone is simply
  // offline: routing changes nothing, and the offline copy takes over.
  if (await reachable("/manifest.json")) {
    remember(true);
    return true;
  }
  return readRemembered();
}

function route(): Promise<boolean> {
  if (!decision) {
    if (readRemembered()) {
      routedThroughProxy = true;
      decision = Promise.resolve(true);
      // Self-healing: back on a network that carries Supabase, forget the
      // detour so the next start talks to it directly again.
      void reachable(`${SUPABASE_URL}/auth/v1/health`).then((ok) => {
        if (ok) remember(false);
      });
    } else {
      decision = probe().then((useProxy) => {
        routedThroughProxy = useProxy;
        return useProxy;
      });
    }
  }
  return decision;
}

function viaProxy(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string" || input instanceof URL) {
    const href = String(input);
    return href.startsWith(SUPABASE_URL) ? PROXY_PREFIX + href.slice(SUPABASE_URL.length) : input;
  }
  if (input instanceof Request && input.url.startsWith(SUPABASE_URL)) {
    return new Request(PROXY_PREFIX + input.url.slice(SUPABASE_URL.length), input);
  }
  return input;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

async function routedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (await route()) return fetch(viaProxy(input), init);
  try {
    return await fetch(input, init);
  } catch (err) {
    // The probe passed but the request itself never got through — a host that
    // answers a two-byte health check and then drops a real query is exactly
    // what a throttling carrier looks like. Switch over for everything that
    // follows, and re-send this one if it is safe to: a GET can be repeated,
    // a write cannot (a retried token refresh would rotate the refresh token
    // twice), so writes only get the new route on their own next attempt —
    // which the sync layer's 15-second retry gives them.
    decision = Promise.resolve(true);
    routedThroughProxy = true;
    remember(true);
    if (methodOf(input, init) !== "GET") throw err;
    return fetch(viaProxy(input), init);
  }
}

// Whether this session is talking to Supabase through our own origin. Only
// meaningful after the first request has been made; callers use it to skip
// work that cannot be routed (the realtime websocket), never to decide
// whether the tracker has data.
export function isRoutedThroughProxy(): boolean {
  return routedThroughProxy;
}

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: routedFetch },
  });
}
