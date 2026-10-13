import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { miniAppSession } from "@/lib/miniAppAuth";
import type { BotChannelConfig } from "@/lib/botTransport";

// The body of both /api/<messenger>/miniapp-auth routes: they differ only in
// where the bot token comes from.
//
// The session is set HERE, as cookies on this response, and the page goes
// straight to «/». It used to come back as a one-time code the page then
// exchanged with Supabase itself — and the browser's first call to Supabase
// is the one that probes whether *.supabase.co is reachable at all (see
// lib/supabase/client), on exactly the mobile networks where it may not be.
// From Vercel's fra1 the same exchange is a few milliseconds away. The code
// is still returned when the exchange here fails, so the page can try it
// the old way rather than give up.
export async function miniAppSignIn(req: Request, channel: BotChannelConfig, botToken: string) {
  const body = (await req.json().catch(() => null)) as { initData?: string } | null;
  const supabase = await createClient();
  // getSession reads the cookie without a network call. It is not trusted
  // for anything here except «skip issuing a new session»: a forged cookie
  // earns nothing but a trip to «/», where the middleware checks it for real.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const admin = createAdminClient();
  const result = await miniAppSession(admin, channel, botToken, String(body?.initData || ""), session?.user?.id ?? null);
  if (!result.ok) return NextResponse.json({ error: result.error, fields: result.fields }, { status: result.status });
  if (result.same) return NextResponse.json({ signedIn: true });

  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: result.tokenHash });
  if (!error) return NextResponse.json({ signedIn: true });
  return NextResponse.json({ tokenHash: result.tokenHash, email: result.email });
}
