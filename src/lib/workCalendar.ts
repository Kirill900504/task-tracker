// Is this a Russian working day? Used to keep the morning "overdue /
// due today" digest out of weekends and public holidays — including the
// shifted days off the официальный производственный календарь introduces
// (e.g. a Monday off because a holiday fell on the weekend), which a plain
// Saturday/Sunday check would miss.
//
// Data comes from isdayoff.ru, a long-running free service that publishes
// exactly that calendar: "0" = working day, "1" = day off, "2" = short
// (pre-holiday) day — which is still a working day, "4" = working day moved
// from a weekend. Anything else (or a failed request) falls back to the
// weekday, so a service outage can only ever cost us the holiday awareness,
// never the reminders themselves.

const cache = new Map<string, boolean>();

function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export async function isRussianWorkingDay(date: Date): Promise<boolean> {
  const key = ymd(date);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let working = !isWeekend(date);
  try {
    // Short timeout: this runs inside a cron request that also has real work
    // to do, and the weekday fallback is a perfectly serviceable answer.
    const res = await fetch(`https://isdayoff.ru/${key}`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const body = (await res.text()).trim();
      if (body === "0" || body === "2" || body === "4") working = true;
      else if (body === "1") working = false;
    }
  } catch {
    /* keep the weekday-based answer */
  }

  cache.set(key, working);
  return working;
}
