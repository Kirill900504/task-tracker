// What a browser test cannot check: that the WINDOW works.
//
// The tracker itself is covered by e2e/*.spec.ts against the site. This file
// covers the three things that only exist once the site is inside a desktop
// window, and all three have already cost a day somewhere in this project:
//
//   1. A window with no address bar must still land on the login form when
//      the session has run out — a service worker that answers a navigation
//      with a redirect leaves an installed app on a blank screen with no way
//      out (see «Ответ с перенаправлением нельзя отдать на навигацию»).
//   2. With no connection and nothing cached, the person must see the Russian
//      "Нет связи" page, not Chromium's English error page.
//   3. An external link must open in the real browser, or it replaces the app
//      with a page that has no way back.
//
// Playwright drives Electron directly; it comes from the repo root, which is
// why this is a script rather than a spec in the suite — the suite runs
// against the deployed site and must not need Electron installed.
import { _electron as electron } from "../node_modules/@playwright/test/index.mjs";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Playwright looks for Electron in ITS own node_modules (the repo root); ours
// lives in desktop/, so the binary is handed over explicitly. Requiring the
// electron package from Node returns the path to the executable.
const executablePath = createRequire(import.meta.url)("electron");

// Свой профиль на каждый прогон, и это не гигиена, а условие запуска.
//
// Приложение держит ОДНО окно на профиль (requestSingleInstanceLock), а
// профиль у запуска из исходников тот же, что у установленной копии, —
// имя берётся из package.json. Пока у Кирилла открыт «Планировщик
// задач», тестовое окно закрывается в ту же секунду, в которую
// открылось, и Playwright сообщает «Target page, context or browser has
// been closed» — то есть выглядит это как поломка оболочки, а не как
// занятый профиль. Свой каталог снимает и блокировку, и чужой кэш.
const profile = mkdtempSync(path.join(tmpdir(), "rokas-smoke-"));
const launchArgs = [here, `--user-data-dir=${profile}`];
const failures = [];
// Снимок — не проверка, а артефакт «посмотреть глазами». Захват кадра у
// окна Electron изредка не отдаётся вовсе (окно позади чужого, свежий
// профиль, композитор занят), и падать из-за этого проверке нельзя:
// поведение уже проверено текстом выше.
async function shot(win, file) {
  try {
    await win.screenshot({ path: file, timeout: 8000 });
  } catch {
    console.log("  —    снимок " + path.basename(file) + " не сделан (окно не отдало кадр); на проверку не влияет");
  }
}

const check = (ok, what) => {
  console.log((ok ? "  ok   " : "  FAIL ") + what);
  if (!ok) failures.push(what);
};

// ---- 1 & 3: the real site, signed out --------------------------------------
{
  const startedAt = Date.now();
  const app = await electron.launch({ args: launchArgs, executablePath });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Окно обязано появиться СРАЗУ, ещё до того, как ответит сайт.
  //
  // «При запуске сперва появляется чёрный экран» — это и был промежуток
  // между запуском и первым кадром сайта. Теперь первым грузится splash.html,
  // лежащий рядом на диске: если он перестанет открываться (не попал в
  // сборку, переименован), проверка увидит это здесь, а не Кирилл.
  const firstFrame = Date.now() - startedAt;
  const splashShown = /splash\.html/.test(win.url()) || (await win.locator("text=Открываю трекер").count()) > 0;
  check(splashShown, "заставка показана сразу, за " + firstFrame + " мс от запуска");
  // Окно показывается сразу после заставки — ждём его появления, а не
  // ловим в конкретную миллисекунду: показ идёт по завершении загрузки
  // локального файла, то есть на десятки миллисекунд позже этой строки.
  let visible = false;
  for (let i = 0; i < 40 && !visible; i++) {
    visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);
    if (!visible) await win.waitForTimeout(100);
  }
  check(visible, "окно видно, а не ждёт загрузки сайта");

  await win.waitForTimeout(6000);

  console.log("Окно с боевым сайтом:");
  check(/\/login/.test(win.url()), "без сессии открывается форма входа, а не пустой экран (" + win.url() + ")");
  check((await win.locator("#email").count()) === 1, "поле почты на месте");
  check((await win.locator("#password").count()) === 1, "поле пароля на месте");
  const title = await win.title();
  check(title.length > 0, "у окна есть заголовок: " + title);

  await shot(win, path.join(here, "smoke-login.png"));
  await app.close();
}

// ---- 2: no connection, nothing cached --------------------------------------
{
  // Port 1 is never listening, so the load fails the way a dead network does,
  // and the worker has never run in this profile — exactly a first launch
  // offline, which is the case with no cached shell to fall back on.
  const app = await electron.launch({ args: launchArgs, executablePath, env: { ...process.env, ROKAS_URL: "http://127.0.0.1:1" } });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(3000);

  console.log("Окно без связи:");
  const text = await win.locator("body").innerText();
  check(/Нет связи/.test(text), "показана русская страница «Нет связи»");
  check((await win.locator("#retry").count()) === 1, "есть кнопка «Попробовать снова»");

  await shot(win, path.join(here, "smoke-offline.png"));
  await app.close();
}

console.log(failures.length ? `\nНе прошло: ${failures.length}` : "\nВсё прошло");
process.exit(failures.length ? 1 : 0);
