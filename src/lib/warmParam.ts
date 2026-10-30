// The sign-in page's warm-up marker (lib/warmTracker). Its own file because
// the session middleware needs it too, and warmTracker pulls in browser-only
// modules (the Supabase browser client, the service-worker cache) that have no
// business in the middleware bundle.
export const WARM_PARAM = "warm";
