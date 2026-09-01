import type { SupabaseClient } from "@supabase/supabase-js";

// Sliding-window rate limit backed by api_rate_limits (migration 0006).
// Fails OPEN on any DB error (including "table doesn't exist yet") — a
// missing migration should never be the reason a legitimate request gets
// blocked; it just means rate limiting is a no-op until the SQL runs.
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  route: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  try {
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { count, error } = await supabase
      .from("api_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("route", route)
      .gte("created_at", since);

    if (error) return { allowed: true };
    if ((count ?? 0) >= limit) return { allowed: false };

    await supabase.from("api_rate_limits").insert({ user_id: userId, route });
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
