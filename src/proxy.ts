import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // "sb/" is the Supabase pass-through (see next.config.ts's rewrites): it
    // carries its own key and is answered by Supabase, so putting it through
    // the session check would only redirect the sign-in request itself to the
    // sign-in page. "vendor/" holds third-party scripts served from our own
    // origin (the Telegram bridge): the mini-app loads it BEFORE anyone is
    // signed in, and a redirect to /login is not a script. "wav" is the
    // close sound (lib/closeSound): a static file needs no session check.
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|manifest.json|sw.js|sb/|vendor/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|wav)$).*)",
  ],
};
