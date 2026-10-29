import { timingSafeEqual } from "node:crypto";

// Does a secret sent by a caller match the one we expect?
//
// Two things went wrong here, each in more than one route (audit
// 29.10.2026). The comparisons were `given !== process.env.X`: when the
// variable is missing, `undefined !== undefined` is false and the webhook
// opened to anyone who simply left the header out — and the backup cron
// compared against the literal "Bearer undefined", a string anybody can
// send. And `!==` stops at the first differing byte, so the time to answer
// leaks how much of a guess was right. So: an empty expected secret never
// matches anything, and the comparison runs in constant time.
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// The cron routes: `Authorization: Bearer <CRON_SECRET>`.
export function bearerMatches(header: string | null, expected: string | null | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return secretMatches(header.slice("Bearer ".length), expected);
}
