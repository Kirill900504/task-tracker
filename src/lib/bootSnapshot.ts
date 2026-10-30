// The tracker opens on a picture of itself, not on the grey skeleton.
//
// 30.10.2026, Кирилл, with a screenshot of BootSkeleton: «при загрузке
// трекера или же когда в нём просто работаешь, периодически он обновляет сам
// себя и появляется это окно прогрузки данных… сделать так, чтобы его не
// было видно». «Периодически» is VersionWatch: every deploy reloads every
// open window, and on a busy day that is several times an hour. The data
// itself is already instant (IndexedDB, cached role and participation), so
// what he sees is the second or so between the HTML and the first React
// frame — JavaScript has to download, parse and hydrate before anything but
// the server-rendered skeleton can exist.
//
// The only thing that can be on screen in that second is HTML. So the page
// keeps a copy of its own rendered markup (body, minus scripts, open windows
// and floating layers) in localStorage, and an inline script in layout.tsx
// pours it into the skeleton's slot before the first paint (RESTORE_SCRIPT
// below). React then replaces the whole slot with the real tracker, drawn
// from the same data with the same classes — so the swap is invisible.
//
// What keeps this honest:
// * It is a picture. Nothing in it reacts (pointer-events off, aria-hidden),
//   because nothing in it is wired up — the same rule as BootSkeleton, «это
//   НЕ второй интерфейс».
// * It belongs to one person. The restore reads the user id from the session
//   cookie and shows the copy only to the same id; «Выйти» deletes it.
// * It matches the layout. A desktop copy is not shown in a phone-width
//   window and vice versa — the two are different DOM, not different CSS.
// * Automated browsers never see it (navigator.webdriver): a test that
//   clicks a dead copy of a button reports a broken tracker.

export const SNAPSHOT_KEY = "kkt_boot_snapshot";
// localStorage holds ~5 MB per origin, shared with the role and
// participation caches. A copy bigger than this is skipped, not truncated —
// half a screen is worse than a skeleton.
const MAX_CHARS = 1_500_000;
// Must stay equal to MOBILE_QUERY in useIsMobile: it decides which DOM the
// copy is (desktop columns or the phone shell).
export const SNAPSHOT_MOBILE_QUERY = "(max-width: 800px)";
// A week-old picture would show tasks long gone for a second; the skeleton
// is the better answer then.
const MAX_AGE_MS = 3 * 24 * 3600_000;

type Stored = { u: string; m: boolean; t: number; h: string };

let owner = "";

// Set by the tracker once it has rendered for real; "" stops saving. Only
// the tracker screen is worth a copy — never /login, never the skeleton.
export function setSnapshotOwner(userId: string): void {
  owner = userId;
}

// Layers that are not part of the resting screen: open windows, menus,
// toasts, the «Сохранено» pill, and everything that is code rather than
// markup.
const DROP =
  "script,style,link,noscript,template,iframe,dialog,[popover],next-route-announcer,#toast-stack,#syncStatus,#bootSnapshot,.skel,.task-peek";

export function saveSnapshot(): void {
  try {
    if (!owner || typeof document === "undefined" || navigator.webdriver) return;
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(DROP).forEach((el) => el.remove());
    const html = clone.innerHTML;
    if (!html || html.length > MAX_CHARS) return;
    const value: Stored = { u: owner, m: window.matchMedia(SNAPSHOT_MOBILE_QUERY).matches, t: Date.now(), h: html };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(value));
  } catch {
    /* quota or private mode — the skeleton is the fallback, as before */
  }
}

export function dropSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* nothing stored */
  }
}

// Runs inline in the HTML, before React and before the first paint, so it
// is plain ES5 in a string — no imports, no bundler. Tested as this exact
// string (bootSnapshot.test.ts). The session cookie is @supabase/ssr's:
// `sb-<ref>-auth-token`, possibly split into `.0`, `.1`… chunks, value
// "base64-" + base64url(JSON) with the user under `user.id`.
export const RESTORE_SCRIPT = `(function(){try{
var el=document.getElementById("bootSnapshot");
if(!el||navigator.webdriver)return;
var s=JSON.parse(localStorage.getItem(${JSON.stringify(SNAPSHOT_KEY)})||"null");
if(!s||!s.h||!s.u||Date.now()-s.t>${MAX_AGE_MS})return;
if(!!s.m!==window.matchMedia(${JSON.stringify(SNAPSHOT_MOBILE_QUERY)}).matches)return;
var parts=[];document.cookie.split(";").forEach(function(c){
var i=c.indexOf("=");var k=c.slice(0,i).trim();var m=/^sb-.+-auth-token(?:\\.(\\d+))?$/.exec(k);
if(m)parts.push([m[1]?+m[1]:-1,decodeURIComponent(c.slice(i+1).trim())]);});
if(!parts.length)return;
parts.sort(function(a,b){return a[0]-b[0];});
var v=parts.map(function(p){return p[1];}).join("");
if(v.indexOf("base64-")===0){v=v.slice(7).replace(/-/g,"+").replace(/_/g,"/");
while(v.length%4)v+="=";var b=atob(v);var bytes=new Uint8Array(b.length);
for(var j=0;j<b.length;j++)bytes[j]=b.charCodeAt(j);v=new TextDecoder().decode(bytes);}
var sess=JSON.parse(v);
if(!sess||!sess.user||sess.user.id!==s.u)return;
el.innerHTML=s.h;document.documentElement.classList.add("boot-snap");
}catch(e){}})();`;
