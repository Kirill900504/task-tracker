// How the sign-in cookies are written — one answer for the browser client,
// the server client and the session middleware, because a cookie written by
// one with different attributes than another is a second cookie as far as a
// browser is concerned, not the same one.
//
// SameSite=None, not the library's default Lax. The reason is the mini-app:
// MAX on a computer (web.max.ru and the desktop client) and Telegram Web open
// it inside an <iframe> on THEIR domain, and inside a cross-site frame a
// browser refuses to store or send a Lax cookie at all. The tracker then
// signed in, went to «/», found no session and landed on /login.
//
// None is what makes a cross-site POST carry the cookie, so it comes with the
// Origin check in the session middleware (`crossSiteWrite`) — that check, not
// SameSite, is what stops another site from acting as the person. Secure is
// required by browsers for None and is honoured on http://localhost too, so
// local runs and e2e keep working.
export const AUTH_COOKIE_OPTIONS = { sameSite: "none" as const, secure: true };
