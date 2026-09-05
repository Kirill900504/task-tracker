// Pure calendar/meeting-list logic, ported from legacy-tracker.js's
// renderCalendar()/renderAllMeetings() sort key. Kept separate from
// component code so the grid-generation and sort-order rules stay
// unit-testable without touching the DOM.
import type { Meeting } from "@/types/tracker";
import { dateStr } from "./taskDisplay";

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return dateStr(new Date(y, m - 1, d + n));
}

// 42 dates (6 full weeks) covering the given month, Monday-first, including
// the leading/trailing days from the adjacent months needed to fill the grid.
export function getMonthGridDates(viewDate: Date): Date[] {
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  const firstOfMonth = new Date(y, m, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const dates: Date[] = [];
  for (let i = 0; i < 42; i++) {
    dates.push(new Date(y, m, 1 - startOffset + i));
  }
  return dates;
}

// Only meetings still "planned" show by default; showResolved reveals
// success/no_result ones too. Sorted by date then time, both ascending.
// Still-planned meetings come first, in chronological order — those are the
// ones that still have to happen, so they stay at the top of the panel. The
// resolved ones follow, most recently closed first (resolvedAt), so the
// meeting just marked ✅/🚫 sits right under the live list and can be put
// back into the plan without hunting for it.
export function sortMeetingsForList(meetings: Meeting[], showResolved: boolean): Meeting[] {
  const isPlanned = (m: Meeting) => !m.status || m.status === "planned";
  return meetings
    .filter((m) => showResolved || isPlanned(m))
    .slice()
    .sort((a, b) => {
      if (isPlanned(a) !== isPlanned(b)) return isPlanned(a) ? -1 : 1;
      if (isPlanned(a)) {
        const ak = `${a.date || ""} ${a.time || ""}`;
        const bk = `${b.date || ""} ${b.time || ""}`;
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      }
      // Resolved: newest first. Anything without a resolvedAt (closed before
      // that column existed, or by an older client) sorts last rather than
      // jumping to the top.
      const ar = a.resolvedAt || "";
      const br = b.resolvedAt || "";
      if (ar !== br) return ar > br ? -1 : 1;
      const ak = `${a.date || ""} ${a.time || ""}`;
      const bk = `${b.date || ""} ${b.time || ""}`;
      return ak > bk ? -1 : ak < bk ? 1 : 0;
    });
}
