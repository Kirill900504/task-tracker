// Pure calendar/meeting-list logic, ported from legacy-tracker.js's
// renderCalendar()/renderAllMeetings() sort key. Kept separate from
// component code so the grid-generation and sort-order rules stay
// unit-testable without touching the DOM.
import type { Meeting } from "@/types/tracker";
import { dateStr } from "./taskDisplay";
import { normalizeDuration } from "./meetingTime";

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
  // Предложенная встреча ещё впереди и в списке стоит вместе с
  // назначенными: прятать её до подтверждения значит прятать то, на что
  // ждут ответа. Время она при этом не занимает — календарь и напоминания
  // спрашивают ровно "planned" (миграция 0034).
  const isPlanned = (m: Meeting) => !m.status || m.status === "planned" || m.status === "proposed";
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

// Встреча прошла, а итога нет.
//
// Четвёртое состояние, которого нет в базе и не должно быть: оно целиком
// выводится из времени и пустого поля «итог». Слова Кирилла 19.09.2026 о
// том, чего он ждёт от встречи: «автоматическим закрытием встреч с
// комментарием ИТОГа, после проведения».
//
// Автоматически закрыть встречу, о которой никто ничего не сказал, нельзя
// — это выдумать за людей, чем она кончилась. Поэтому «закрывается» она
// вопросом: бот спрашивает организатора через два часа (см. recapDue), а
// в трекере такая встреча отделяется от будущих и просит итог.
//
// С КОНЦА встречи, а не через час после начала (21.10.2026). Час брался
// «на всякий случай» — встреча в 15:00 в 15:05 ещё идёт, и просить итог
// значит мешать. Но конец встречи известен точно: начало плюс её полчаса
// или час (`durationMin`). С запасом в час получасовая встреча в 9:00
// просила итог только в 10:00, и Кирилл увидел это на встрече «тест
// просрочка»: «по истечении времени должен срабатывать триггер». Время
// вышло — итог нужен; кроны «время вышло» считают по тому же концу.
//
// Закрывает встречу ИСХОД, а не текст в поле итога (16.10.2026). Поле
// пишется само при выходе из него, и встреча с набранным итогом, но без
// «Успех / Провал», оставалась planned навсегда — а правило «есть текст —
// вопрос снят» прятало её: ни плашки, ни группы «Нужен итог», ни вопроса
// бота. Кирилл увидел это на тестовой встрече, просроченной на сутки и
// ничем не помеченной.
// Сколько минут от начала до момента, когда встреча просит итог. У встречи
// без времени («весь день») конец — конец дня, и длительность ни при чём.
export function recapAfterMinutes(meeting: { time?: string | null; durationMin?: unknown }): number {
  return meeting.time ? normalizeDuration(meeting.durationMin) : 0;
}

export function awaitsRecap(meeting: Meeting, now: Date = new Date()): boolean {
  if (meeting.status && meeting.status !== "planned") return false;
  if (!meeting.date) return false;
  const [hh, mm] = (meeting.time || "23:59").split(":").map(Number);
  const start = new Date(meeting.date + "T00:00:00");
  if (Number.isNaN(start.getTime())) return false;
  start.setHours(Number.isNaN(hh) ? 23 : hh, Number.isNaN(mm) ? 59 : mm, 0, 0);
  return now.getTime() - start.getTime() >= recapAfterMinutes(meeting) * 60_000;
}
