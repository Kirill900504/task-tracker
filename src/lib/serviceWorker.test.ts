import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { resolve } from "node:path";

// public/sw.js is the one file in this project that no build touches and no
// test could reach: it runs in a worker, it is plain JavaScript, and it is
// loaded by the browser directly. That is also why it broke the installed
// app on 19.09.2026 while every check was green — the rule it violated was
// written in its own comments, twice, and nothing enforced it.
//
// So the worker is loaded here into a hand-made global scope and its fetch
// handler is called the way the browser calls it. What is tested is the one
// thing that cannot be seen by looking: WHAT the worker hands back for a
// navigation. A response the browser refuses looks, from the inside, like a
// response.

type FakeResponse = {
  ok: boolean;
  redirected: boolean;
  url: string;
  status: number;
  body: string;
  clone: () => FakeResponse;
};

function reply(patch: Partial<FakeResponse>): FakeResponse {
  const response: FakeResponse = {
    ok: true,
    redirected: false,
    url: "https://tracker.test/",
    status: 200,
    body: "<html>трекер</html>",
    clone: () => response,
    ...patch,
  };
  response.clone = () => response;
  return response;
}

type Worker = {
  handlers: Map<string, ((event: unknown) => void)[]>;
  cache: Map<string, unknown>;
  setFetch: (fn: (request: { url: string }) => Promise<unknown>) => void;
  navigate: (url: string) => Promise<Response | FakeResponse>;
};

function loadWorker(): Worker {
  const source = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
  const handlers = new Map<string, ((event: unknown) => void)[]>();
  const store = new Map<string, unknown>();
  const cache = {
    match: async (key: unknown) => store.get(typeof key === "string" ? key : (key as { url: string }).url),
    put: async (key: unknown, value: unknown) => {
      store.set(typeof key === "string" ? key : (key as { url: string }).url, value);
    },
    add: async () => {},
  };

  let fetcher: (request: { url: string }) => Promise<unknown> = async () => {
    throw new Error("сеть недоступна");
  };

  const self = {
    addEventListener(name: string, handler: (event: unknown) => void) {
      handlers.set(name, [...(handlers.get(name) || []), handler]);
    },
    location: { origin: "https://tracker.test" },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  const context = createContext({
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: (request: { url: string }) => fetcher(request),
    URL,
    Response,
    console,
  });
  runInContext(source, context);

  return {
    handlers,
    cache: store,
    setFetch(fn) {
      fetcher = fn;
    },
    async navigate(url: string) {
      const request = { url, method: "GET", mode: "navigate" };
      let answer: Promise<Response | FakeResponse> | null = null;
      const handler = handlers.get("fetch")?.[0];
      handler?.({
        request,
        respondWith(promise: Promise<Response | FakeResponse>) {
          answer = promise;
        },
      });
      if (!answer) throw new Error("воркер не ответил на навигацию");
      return await answer;
    },
  };
}

describe("сервис-воркер: ответ на навигацию", () => {
  let worker: Worker;

  beforeEach(() => {
    worker = loadWorker();
  });

  it("не отдаёт ответ, полученный через перенаправление", async () => {
    // Именно это убило установленное приложение: «/» уводит на /login, как
    // только кончилась сессия, fetch проходит по перенаправлению сам, а
    // браузер такой ответ на навигацию отвергает — и окно, у которого нет
    // адресной строки, больше не открывается никогда.
    worker.setFetch(async () => reply({ redirected: true, url: "https://tracker.test/login" }));

    const answer = (await worker.navigate("https://tracker.test/")) as Response;

    expect(answer.status).toBe(302);
    expect(answer.headers.get("location")).toBe("https://tracker.test/login");
  });

  it("обычный ответ отдаёт как есть", async () => {
    const page = reply({});
    worker.setFetch(async () => page);
    expect(await worker.navigate("https://tracker.test/")).toBe(page);
  });

  it("страницу входа не кладёт в кэш вместо трекера", async () => {
    // Иначе без связи приложение открывается на форме входа, которую
    // отправить всё равно некуда.
    worker.setFetch(async () => reply({ url: "https://tracker.test/login" }));
    await worker.navigate("https://tracker.test/login");
    expect(worker.cache.has("/")).toBe(false);
  });

  it("сам трекер в кэш кладёт", async () => {
    worker.setFetch(async () => reply({ url: "https://tracker.test/" }));
    await worker.navigate("https://tracker.test/");
    expect(worker.cache.has("/")).toBe(true);
  });

  it("без сети отдаёт сохранённый трекер", async () => {
    worker.setFetch(async () => reply({ url: "https://tracker.test/" }));
    await worker.navigate("https://tracker.test/");

    worker.setFetch(async () => {
      throw new Error("сеть недоступна");
    });
    const answer = (await worker.navigate("https://tracker.test/")) as FakeResponse;
    expect(answer.body).toContain("трекер");
  });

  it("без сети и без кэша объясняет это по-русски, а не падает", async () => {
    worker.setFetch(async () => {
      throw new Error("сеть недоступна");
    });
    const answer = (await worker.navigate("https://tracker.test/")) as Response;
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("Нет связи");
  });
});
