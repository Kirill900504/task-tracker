import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// 14.10.2026, Kirill: «когда открывается мобильное приложение очень долго
// прогружается белый экран, бывает вообще дальше белого экрана ничего не
// происходит… удостоверься, что… открывается моментально». Two causes, one
// test each:
//
// 1. The service worker answered the tracker's address network-first. A
//    network that hangs rather than refuses (a slow phone, or a Russian
//    network filtering *.vercel.app by name) kept the window white for as
//    long as it hung — forever, in the second case — with a working copy in
//    the cache. Here the network for the page itself never answers at all.
// 2. Every open from a messenger waited for the sign-in route before going
//    anywhere, even for someone signed in on this phone yesterday.
const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// The copy only exists in a production build with the worker running — a
// local `next dev` unregisters it on purpose (see registerSW.ts).
async function signInAndWaitForShell(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#mobileNav")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!navigator.serviceWorker?.controller) return false;
          const cache = await caches.open("rokas-shell-v2");
          return !!(await cache.match("/", { ignoreVary: true }));
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}

// Requests for the page itself (made by the worker's background refresh)
// get no answer, ever — not an error, silence, the way a filtering network
// behaves. Everything else passes.
async function hangThePage(context: BrowserContext, paths: string[]) {
  await context.route(
    (url) => paths.includes(url.pathname),
    () => new Promise(() => {}),
  );
}

test("установленное приложение открывается из копии, даже когда сеть молчит", async ({ page, context }) => {
  await signInAndWaitForShell(page);

  await hangThePage(context, ["/"]);
  const started = Date.now();
  await page.goto("/", { waitUntil: "commit", timeout: 10_000 });
  await expect(page.locator("#mobileNav")).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - started;
  console.log(`трекер открылся из копии за ${ms} мс при молчащей сети`);
  expect(ms).toBeLessThan(5_000);

  // И первый кадр тёмный, а не белый: цвет стоит в самом теге <html>.
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(35, 43, 46)");
});

test("из мессенджера уже вошедший человек попадает в трекер сразу, без экрана входа", async ({ page }) => {
  await signInAndWaitForShell(page);

  // Подпись выдуманная: маршрут входа её отвергнет. Именно так и надо —
  // проверка идёт ФОНОМ и на экран уже вошедшего человека не влияет; а
  // настоящую подпись Telegram здесь не воспроизвести (CLAUDE.md, урок о
  // подписях). Важно другое: на /app человек не задерживается.
  let authAsked = false;
  page.on("request", (r) => {
    if (r.url().includes("/miniapp-auth")) authAsked = true;
  });
  const started = Date.now();
  await page.goto("/app#tgWebAppData=query_id%3Dtest%26user%3D%257B%2522id%2522%253A1%257D%26hash%3Dx&tgWebAppVersion=8.0");
  await expect(page).toHaveURL(/\/#tgWebAppData=/, { timeout: 5_000 });
  await expect(page.locator("#mobileNav")).toBeVisible({ timeout: 10_000 });
  const ms = Date.now() - started;
  console.log(`из мессенджера в трекер за ${ms} мс`);
  expect(ms).toBeLessThan(5_000);

  // Подпись всё-таки проверили — фоном, с «/».
  await expect.poll(() => authAsked, { timeout: 10_000 }).toBe(true);
  // И отказ её не выкинул человека из трекера.
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/(#.*)?$/);
  await expect(page.locator("#mobileNav")).toBeVisible();
});
