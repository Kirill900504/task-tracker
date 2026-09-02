import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
  // Telegram and the external cron pinger call these with their own
  // secret-token checks, not a browser session — never gate them behind
  // the login redirect.
  const isServerToServerRoute =
    request.nextUrl.pathname.startsWith("/api/telegram/webhook") ||
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
