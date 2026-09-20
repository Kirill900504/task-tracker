"use strict";

// The desktop app is a window around the deployed tracker, not a copy of it.
//
// That is the whole design, and it is deliberate: everything a release adds
// to task-tracker-beta-ebon.vercel.app is in front of the person the next
// time they open this window, with nothing to download and nobody to tell.
// Кирилл asked for exactly that — «чтобы все изменения при новом открытии
// приложения сами автоматически устанавливались». Shipping a bundled copy of
// the app would have turned every text change into a release fourteen people
// have to install.
//
// So what ships here is only the frame: a window, an icon, an updater for the
// frame itself (rare — it changes when THIS file changes, not when the
// tracker does), and the handful of rules that make a browser engine behave
// like an application rather than a tab.

const { app, BrowserWindow, Menu, nativeTheme, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");

const APP_URL = process.env.ROKAS_URL || "https://task-tracker-beta-ebon.vercel.app";
const APP_ORIGIN = new URL(APP_URL).origin;

// Window size and position live next to the app's own data, so a person who
// sized the window once does not do it again after every update. A corrupt or
// missing file is not an error — it just means "no preference yet".
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (typeof saved.width === "number" && typeof saved.height === "number") return saved;
  } catch {
    /* no saved state, or it is unreadable — both mean "use the defaults" */
  }
  return { width: 1360, height: 900 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    /* losing the window size is not worth an error dialog */
  }
}

let mainWindow = null;

function createWindow() {
  const state = readWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    // Matches --paper in tracker.css: without it every start flashes white
    // before the page paints, which reads as "something went wrong".
    backgroundColor: "#232B2E",
    // The window is empty until the page is ready; showing it earlier means
    // the person watches an empty frame while the site loads.
    show: false,
    autoHideMenuBar: true,
    // .ico, а не .png: в заголовке окна и на панели задач Windows рисует
    // иконку в 16–32 пикселя, и из одного большого PNG она сжимается в
    // серую кашу. В .ico лежат семь размеров, и маленькие — это только
    // сам знак, без слова и подписи, которые в такой величине всё равно
    // не читаются (см. build/icon.ico).
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      // Nothing of ours runs in the page: the tracker is a website and stays
      // one. No preload, no node integration, no bridge to abuse.
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", () => saveWindowState(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Anything outside our own origin — a Telegram link, a MAX chat, a file a
  // colleague attached on some other host — belongs in the person's real
  // browser, where their logins already are. Opening it inside this window
  // would trap them in an app with no address bar and no way back.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_ORIGIN)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  // No connection and nothing cached: the service worker answers this case
  // itself with its own Russian page, but it can only do that once it has
  // been installed. On a first-ever launch offline there is no worker yet,
  // and Chromium's own error page is English and looks like a broken app.
  mainWindow.webContents.on("did-fail-load", (event, errorCode, _desc, failedUrl, isMainFrame) => {
    // -3 is ERR_ABORTED, which is what a redirect or a cancelled navigation
    // reports; it is not a failure anyone needs to see.
    if (!isMainFrame || errorCode === -3) return;
    void mainWindow.loadFile(path.join(__dirname, "offline.html"), { query: { url: failedUrl } });
    // И показать окно. Оно ждёт "ready-to-show", чтобы не мигать пустой
    // рамкой, пока грузится сайт, — но у страницы, загруженной ВМЕСТО
    // упавшей, это событие может не прийти вовсе, и первый запуск без
    // сети тогда выглядит как приложение, которое запустилось и не
    // открылось: значок в панели задач есть, окна нет. Показ стоит
    // ДО ожидания загрузки, а не после: сама страница лежит рядом на
    // диске и рисуется мгновенно, а вот обещание loadFile при отменённой
    // навигации может не исполниться никогда.
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  });

  void mainWindow.loadURL(APP_URL);
}

// One window, always. Launching the app again — from the taskbar, from the
// installer's "run now" — raises the window that is already open instead of
// starting a second copy with its own session.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // Тёмная рамка окна вместо светлой системной.
    //
    // Слова Кирилла 20.09.2026: «можно ли заменить верхнюю полоску границы
    // приложения (шапку) на шапку в тёмном фирменном стиле?» Можно, и
    // одной строкой: Windows красит заголовок окна по теме приложения, а
    // не по теме системы, если приложение о своей теме заявило. Свою
    // шапку рисовать не нужно — с ней пришлось бы двигать всю шапку
    // трекера, чтобы кнопки «Команда» и «Выйти» не оказались под
    // системными «свернуть/закрыть».
    nativeTheme.themeSource = "dark";
    buildMenu();
    createWindow();
    checkForUpdates();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// The menu bar is hidden (Alt shows it) and exists for one reason: without a
// menu, Chromium's editing shortcuts — copy, paste, select all — have nothing
// to bind to, and a person who cannot paste a task title into the app blames
// the app. Everything here is a role, so Electron localises and wires it.
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Трекер",
        submenu: [
          { label: "Обновить страницу", accelerator: "CmdOrCtrl+R", role: "reload" },
          { label: "Во весь экран", accelerator: "F11", role: "togglefullscreen" },
          { type: "separator" },
          { label: "Проверить обновления", click: () => checkForUpdates({ tellMe: true }) },
          { type: "separator" },
          { label: "Выход", accelerator: "CmdOrCtrl+Q", role: "quit" },
        ],
      },
      {
        label: "Правка",
        submenu: [
          { label: "Отменить", role: "undo" },
          { label: "Повторить", role: "redo" },
          { type: "separator" },
          { label: "Вырезать", role: "cut" },
          { label: "Копировать", role: "copy" },
          { label: "Вставить", role: "paste" },
          { label: "Выделить всё", role: "selectAll" },
        ],
      },
      {
        label: "Масштаб",
        submenu: [
          { label: "Крупнее", role: "zoomIn" },
          { label: "Мельче", role: "zoomOut" },
          { label: "Обычный", role: "resetZoom" },
        ],
      },
    ]),
  );
}

// Updating the FRAME, which is not the same thing as updating the tracker.
//
// The tracker updates itself by being a website. This updater exists for the
// rare release that changes this file — and it is deliberately silent: it
// downloads in the background and installs when the person closes the app,
// so nobody is ever interrupted by a dialog about a window frame. The manual
// menu item is the exception: somebody who asked deserves an answer either
// way, including "у вас уже последняя".
function checkForUpdates({ tellMe = false } = {}) {
  // An unpackaged run (npm start) has no update feed to read, and asking for
  // one throws — which would take the whole app down on launch.
  if (!app.isPackaged) {
    if (tellMe) void dialog.showMessageBox({ message: "Обновления проверяются только в установленном приложении.", buttons: ["Понятно"] });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  if (tellMe) {
    autoUpdater.once("update-not-available", () => {
      void dialog.showMessageBox({ message: "У вас последняя версия приложения.", buttons: ["Хорошо"] });
    });
    autoUpdater.once("update-downloaded", () => {
      void dialog
        .showMessageBox({
          message: "Обновление загружено. Установить сейчас? Приложение закроется и откроется снова.",
          buttons: ["Установить", "Позже"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
    });
    autoUpdater.once("error", (error) => {
      void dialog.showMessageBox({ message: "Не получилось проверить обновления: " + String(error?.message || error), buttons: ["Закрыть"] });
    });
  }

  // A failed check must never stop the app from opening: the tracker itself
  // is online and fine, and «не могу проверить обновления» is not a reason
  // to keep somebody out of their tasks.
  autoUpdater.checkForUpdates().catch(() => {});
}
