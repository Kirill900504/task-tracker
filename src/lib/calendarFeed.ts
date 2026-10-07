import { createHmac, timingSafeEqual } from "node:crypto";

// Встречи трекера — в календаре телефона, подпиской (ICS).
//
// Взято у ведущих трекеров (Vikunja, Google Calendar, Todoist): человек
// смотрит своё расписание в календаре телефона, а не в трекере, и встреча,
// которой там нет, для него не существует до утренней сводки. Подписка —
// это одна ссылка: календарь сам перечитывает её и сам напоминает за
// пятнадцать минут, без единого сообщения от бота.
//
// Ссылка — пароль к расписанию одного человека, поэтому она подписана
// секретом сервера и ничего нового в базе не хранит: `id.подпись`. Без
// секрета её не подделать, а показать её можно только самому человеку
// (маршрут /api/calendar/link отвечает по его сессии).

const LABEL = "calendar-feed-v1";

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update(LABEL).digest();
}

function sign(userId: string, secret: string): string {
  return createHmac("sha256", key(secret)).update(userId).digest("base64url").slice(0, 32);
}

export function calendarToken(userId: string, secret: string): string {
  return `${userId}.${sign(userId, secret)}`;
}

// Чей это календарь — или null. Сравнение постоянного времени: по времени
// ответа подпись иначе подбиралась бы побайтно.
export function verifyCalendarToken(token: string, secret: string): string | null {
  const clean = token.replace(/\.ics$/i, "");
  const dot = clean.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = clean.slice(0, dot);
  const given = Buffer.from(clean.slice(dot + 1));
  const expected = Buffer.from(sign(userId, secret));
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? userId : null;
}

export type FeedMeeting = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM, московское
  durationMin: number | null;
  participants: string[];
  status: string | null;
  result?: string | null;
};

// RFC 5545: запятая, точка с запятой и обратная черта экранируются,
// перевод строки — \n.
function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Строки длиннее 75 октетов переносятся пробелом в начале следующей — по
// байтам, а не по символам: кириллица — два байта на букву.
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const local = (date: string, minutes: number) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${date.replace(/-/g, "")}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
};

export function buildIcs(meetings: FeedMeeting[], now: Date = new Date()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ROKAS//Планировщик задач//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:РОКАС — встречи",
    "X-WR-TIMEZONE:Europe/Moscow",
    // Москва без перехода на летнее время с 2014 года — одно правило на всё.
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Moscow",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0300",
    "TZNAME:MSK",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const m of meetings) {
    const lines2: string[] = ["BEGIN:VEVENT", `UID:${m.id}@rokas-tracker`, `DTSTAMP:${stamp(now)}`];
    const [hh, mm] = (m.time || "").split(":").map(Number);
    if (m.time && !Number.isNaN(hh) && !Number.isNaN(mm)) {
      const start = hh * 60 + mm;
      const end = start + (m.durationMin && m.durationMin > 0 ? m.durationMin : 30);
      lines2.push(`DTSTART;TZID=Europe/Moscow:${local(m.date, start)}`, `DTEND;TZID=Europe/Moscow:${local(m.date, end)}`);
    } else {
      // Без времени — событие на весь день, а не на полночь.
      lines2.push(`DTSTART;VALUE=DATE:${m.date.replace(/-/g, "")}`);
    }
    lines2.push(`SUMMARY:${esc(m.title || "Встреча")}`);
    const desc = [m.participants.length ? "Участники: " + m.participants.join(", ") : "", m.result ? "Итог: " + m.result : ""].filter(Boolean).join("\n");
    if (desc) lines2.push(`DESCRIPTION:${esc(desc)}`);
    // Предложенная встреча времени не занимает (см. CLAUDE.md) — в
    // календаре это «под вопросом», а не «занят».
    lines2.push(`STATUS:${m.status === "proposed" ? "TENTATIVE" : "CONFIRMED"}`);
    if (m.time) lines2.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(m.title || "Встреча")}`, "TRIGGER:-PT15M", "END:VALARM");
    lines2.push("END:VEVENT");
    lines.push(...lines2);
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
