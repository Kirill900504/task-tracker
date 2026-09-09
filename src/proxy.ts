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
    // sign-in page.
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|manifest.json|sw.js|sb/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
