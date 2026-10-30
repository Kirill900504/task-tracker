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
import net from "node:net";
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
  // The same painted-frame question as below: a page that loaded but never
  // reached the screen reads as an app that hung on its splash.
  const painted = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().length,
  );
  check(painted > 0, "форма входа нарисована в окне");

  await shot(win, path.join(here, "smoke-login.png"));

  // Правая кнопка по слову с ошибкой: у окна Electron своего меню нет, и
  // без обработчика подчёркнутое слово исправить было нечем (30.10.2026).
  // Само меню — чистая функция, её проверяем на выдуманном нажатии; у окна
  // — что обработчик действительно висит.
  console.log("Меню правой кнопки:");
  const { contextMenuTemplate } = createRequire(import.meta.url)("./contextMenu.js");
  const replaced = [];
  const typo = contextMenuTemplate(
    { isEditable: true, misspelledWord: "превет", dictionarySuggestions: ["привет", "пребудет"], editFlags: { canCopy: true, canPaste: true } },
    { replace: (w) => replaced.push(w), learn: () => {} },
  );
  check(typo[0]?.label === "привет" && typo[1]?.label === "пребудет", "варианты исправлений стоят первыми");
  typo[0]?.click?.();
  check(replaced[0] === "привет", "нажатие варианта заменяет слово");
  check(typo.some((i) => i.label === "Добавить в словарь"), "есть «Добавить в словарь»");
  check(typo.some((i) => i.role === "paste"), "в поле есть «Вставить»");
  check(contextMenuTemplate({ isEditable: false, selectionText: "" }, {}).length === 0, "мимо полей и выделения меню нет — как прежде");
  const listening = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.listenerCount("context-menu"),
  );
  check(listening > 0, "окно слушает правую кнопку");

  // Нажатие на уведомление поднимает свёрнутое окно. Страница подаёт знак
  // меткой в адресе (useDesktopAlerts.raiseWindow), оболочка его ловит;
  // если метку переименуют с одной стороны и забудут с другой, уведомление
  // будет открывать задачу в окне, которого не видно.
  console.log("Нажатие на уведомление:");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    const back = location.pathname + location.search;
    history.replaceState(history.state, "", back + "#rokas-raise");
    history.replaceState(history.state, "", back);
  });
  let raised = false;
  for (let i = 0; i < 20 && !raised; i++) {
    await win.waitForTimeout(100);
    raised = await app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isMinimized());
  }
  check(raised, "свёрнутое окно разворачивается по метке #rokas-raise");
  check(!/#rokas-raise/.test(win.url()), "метка в адресе не остаётся");
  await app.close();
}

// ---- 2: no connection, nothing cached --------------------------------------
//
// Three ways a network says no, because each fails differently: nothing
// listening (port 1, refused); a filter that resets the connection — the
// way Russian networks cut vercel.app by name (Евгений Макаров, 21.10.2026);
// and one that accepts and then says nothing at all (the watchdog in
// main.js). Each profile is fresh, so no worker has ever run: a first
// launch offline, with no cached shell to fall back on.
//
// The check is the PAINTED FRAME, not the page text. Until 21.10.2026 this
// block read innerText, which said «Нет связи» while the screen still showed
// the splash: after a failed load the Electron window never painted another
// page, and the empty capture was written off in shot() above as «окно не
// отдало кадр». Here an empty frame is the failure.
const sinks = [];
for (const mode of ["refused", "reset", "hang"]) {
  let url = "http://127.0.0.1:1";
  if (mode !== "refused") {
    const server = net.createServer((sock) => {
      if (mode === "reset") sock.resetAndDestroy();
      else sinks.push(sock);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    sinks.push(server);
    url = `https://127.0.0.1:${server.address().port}`;
  }
  const own = mkdtempSync(path.join(tmpdir(), "rokas-smoke-"));
  const app = await electron.launch({ args: [here, `--user-data-dir=${own}`], executablePath, env: { ...process.env, ROKAS_URL: url } });
  await app.firstWindow();
  console.log(`Окно без связи (${mode}):`);
  let state = { text: "", retry: false, painted: 0, windows: 0 };
  const until = Date.now() + (mode === "hang" ? 40000 : 10000);
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    // The window is replaced on failure (main.js, showOffline), and a probe
    // that lands in that instant loses its window mid-call; the next one
    // finds the new window.
    state = await app.evaluate(async ({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const w = all[all.length - 1];
      // A page whose navigation is still pending answers executeJavaScript
      // only when that navigation ends — for a silent network, never.
      const read = (js) =>
        Promise.race([w.webContents.executeJavaScript(js).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
      return {
        text: (await read("document.body ? document.body.innerText : ''")) || "",
        retry: !!(await read("!!document.getElementById('retry')")),
        painted: (await w.webContents.capturePage()).toPNG().length,
        windows: all.length,
      };
    }).catch(() => state);
    if (/Нет связи/.test(state.text) && state.painted > 0) break;
  }
  check(/Нет связи/.test(state.text), "показана русская страница «Нет связи»");
  check(state.retry, "есть кнопка «Попробовать снова»");
  check(state.painted > 0, "страница нарисована в окне, а не только загружена");
  check(state.windows === 1, "окно одно");
  if (mode === "reset") {
    const all = app.windows();
    await shot(all[all.length - 1], path.join(here, "smoke-offline.png"));
    // «Попробовать снова» в той же сети падает снова — и обязано снова
    // оказаться на нарисованной странице, а не на испорченном окне.
    await app.evaluate(({ BrowserWindow }) => {
      const ws = BrowserWindow.getAllWindows();
      void ws[ws.length - 1].webContents.executeJavaScript("document.getElementById('retry').click()");
    });
    let again = { painted: 0, windows: 0, text: "" };
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      again = await app.evaluate(async ({ BrowserWindow }) => {
        const ws = BrowserWindow.getAllWindows();
        const w = ws[ws.length - 1];
        const text = await Promise.race([w.webContents.executeJavaScript("document.body.innerText").catch(() => ""), new Promise((r) => setTimeout(() => r(""), 1500))]);
        return { painted: (await w.webContents.capturePage()).toPNG().length, windows: ws.length, text };
      }).catch(() => again);
      if (again.painted > 0 && /Нет связи/.test(again.text) && again.windows === 1) break;
    }
    check(again.painted > 0 && /Нет связи/.test(again.text) && again.windows === 1, "«Попробовать снова» без связи снова показывает нарисованную страницу");
  }
  await app.close();
}
for (const s of sinks) (s.destroy || s.close).call(s);

console.log(failures.length ? `\nНе прошло: ${failures.length}` : "\nВсё прошло");
process.exit(failures.length ? 1 : 0);
