import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "./cookieOptions";
import { WARM_PARAM } from "@/lib/warmParam";

// A write to /api sent by a page on ANOTHER site. The sign-in cookie is
// SameSite=None (see cookieOptions — the mini-app lives in MAX's and
// Telegram's frames), so the browser attaches it to such a request, and the
// routes read their bodies with req.json() whatever the Content-Type: without
// this check any page the person happens to open could press «Принял» or
// delete a task on his behalf. Browsers always send Origin on
// a cross-site POST; a missing one means a server calling us (the messenger
// webhooks, the cron pinger), and those carry their own secrets.
export function crossSiteWrite(method: string, origin: string | null, host: string | null): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function updateSession(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    crossSiteWrite(request.method, request.headers.get("origin"), request.headers.get("host"))
  ) {
    return NextResponse.json({ error: "Запрос пришёл не со страницы трекера" }, { status: 403 });
  }
  // Маршруты /api — мимо, и ДО всякого обращения к Supabase.
  //
  // `auth.getUser()` ниже — это запрос по сети, и стоял он первой строкой:
  // его платил каждый вызов из браузера («Принял», «Сделал», отправка в
  // мессенджер…), хотя маршрут сразу после проверяет пользователя ещё раз
  // сам, и каждое нажатие кнопки в Telegram и MAX, хотя вебхуку сессия не
  // нужна вовсе. Перенаправлять /api на страницу входа и так бессмысленно:
  // браузер получил бы HTML формы вместо ответа. Каждый маршрут /api,
  // который зовёт браузер, проверяет вход сам (getUser), остальные — своим
  // секретом или публичны нарочно (проверено 07.10.2026 по всем route.ts).
  // Токен при этом не протухает: его обновляет клиент в браузере и
  // прослойка на переходах между страницами.
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next({ request });
  // Публичные страницы — тоже до сетевого запроса: их досрочные выходы ниже
  // стояли ПОСЛЕ getUser и платили его зря (почему каждая публична —
  // написано у её проверки ниже).
  const path = request.nextUrl.pathname;
  // /welcome — страница приглашения (lib/welcomeInvite): её открывает
  // человек, у которого ещё нет ни входа, ни сессии.
  if (["/reset-password", "/join", "/app", "/enter", "/welcome"].some((p) => path.startsWith(p))) return NextResponse.next({ request });
  // Прогрев со страницы входа (lib/warmTracker): человек ещё не вошёл, а
  // файлы трекера уже качаются. «/» — клиентская оболочка, на сервере она
  // рисует только каркас, а данные читает браузер под правами базы, так что
  // без сессии здесь отдавать нечего, кроме ссылок на тот же публичный JS.
  // Отправь мы этот запрос на /login — прогрева нет, и после «Войти» всё
  // качается с нуля (замер 30.10.2026: 2,8 с из 5,7).
  if (path === "/" && request.nextUrl.searchParams.has(WARM_PARAM)) return NextResponse.next({ request });

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  // The password-recovery email link lands here with a code the client
  // still needs to exchange for a session — middleware runs before that JS
  // has a chance to, so it must not redirect this away first.
  const isResetPasswordPage = request.nextUrl.pathname.startsWith("/reset-password");
  if (isResetPasswordPage) return supabaseResponse;
  // Redeeming an invitation is by definition done by someone who has no
  // account yet — sending him to /login would send him to a form he cannot
  // pass. The page and the route it posts to are the only public ones, and
  // the invite code is what stands in for a session there.
  const isJoinPage = request.nextUrl.pathname.startsWith("/join");
  const isJoinRoute = request.nextUrl.pathname.startsWith("/api/workspace/join");
  if (isJoinPage || isJoinRoute) return supabaseResponse;
  // «Забыли пароль?» по определению нажимает тот, кто войти не может, — а
  // значит сессии у него нет и быть не должно. Маршрут отвечает всем
  // одинаково и сам решает, кому и куда слать ссылку.
  if (request.nextUrl.pathname.startsWith("/api/workspace/forgot-password")) return supabaseResponse;
  // Сообщение о поломке принимается всегда — в том числе от того, кто не
  // вошёл: страница входа падает так же, как остальные, и именно про такое
  // падение мы бы не узнали никогда. Маршрут сам разбирается, чья это
  // сессия, и сам себя ограничивает по частоте.
  if (request.nextUrl.pathname.startsWith("/api/client-error")) return supabaseResponse;
  // Мини-приложение: сюда человек попадает ИМЕННО потому, что сессии у
  // него нет, — страница меняет подпись мессенджера на сессию и уходит на
  // трекер. Отправить её на /login значит показать форму входа вместо
  // входа, который в эту секунду происходит сам.
  if (request.nextUrl.pathname.startsWith("/app")) return supabaseResponse;
  // Вход по ссылке из мессенджера — ровно то же самое и по той же причине:
  // сессии у человека нет, она появляется прямо здесь, из одноразового
  // кода в адресе. Отправить его на /login значит показать форму входа
  // тому, кто в эту секунду входит (см. /enter).
  if (request.nextUrl.pathname.startsWith("/enter")) return supabaseResponse;
  if (request.nextUrl.pathname.endsWith("/miniapp-auth")) return supabaseResponse;
  // The messengers and the external cron pinger call these with their own
  // secret-token checks, not a browser session — never gate them behind
  // the login redirect. (A missed entry here does not fail loudly: the POST
  // is redirected to /login and comes back 405, with nothing in the logs to
  // say why — which is exactly how the MAX webhook first behaved.)
  const isServerToServerRoute =
    request.nextUrl.pathname.startsWith("/api/telegram/webhook") ||
    request.nextUrl.pathname.startsWith("/api/max/webhook") ||
    request.nextUrl.pathname.startsWith("/api/cron/");
  if (isServerToServerRoute) return supabaseResponse;

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
