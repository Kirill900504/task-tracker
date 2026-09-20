// Когда напоминать о встрече и кому.
//
// «За 15 минут» — единственное напоминание, которое было, и оно приходило
// только владельцу. Этого мало в обе стороны: за пятнадцать минут уже
// ничего не переиграешь, а человек, которого ждут, о встрече вообще не
// узнавал, если не открыл мессенджер в нужную минуту.
//
// Отсюда четыре срока. Ранние — чтобы успеть перенести или дождаться
// ответа; поздние — чтобы дошли до тех, кто уже согласился. И разное
// содержание: молчащего спрашивают ещё раз, согласившемуся просто
// напоминают.

import type { BotButton } from "@/lib/botTransport";
import { encodeCallback } from "@/lib/colleagues";

export type ReminderKind = "meeting_24h" | "meeting_2h" | "meeting_30m" | "meeting_soon" | "meeting_now";

export type ReminderWindow = {
  kind: ReminderKind;
  // За сколько минут до начала. 0 — сама встреча.
  beforeMinutes: number;
  // Ширина окна: пингер ходит раз в несколько минут, и попасть в точную
  // минуту он не обязан. Дедупликация всё равно не даст послать дважды.
  windowMinutes: number;
  // Ранние напоминания адресованы тем, кто ещё не ответил: их смысл —
  // получить ответ, пока время можно двигать. Поздние — тем, кто придёт.
  audience: "unanswered" | "coming";
};

export const REMINDER_WINDOWS: ReminderWindow[] = [
  { kind: "meeting_24h", beforeMinutes: 24 * 60, windowMinutes: 10, audience: "unanswered" },
  { kind: "meeting_2h", beforeMinutes: 120, windowMinutes: 10, audience: "unanswered" },
  { kind: "meeting_30m", beforeMinutes: 30, windowMinutes: 8, audience: "coming" },
  { kind: "meeting_soon", beforeMinutes: 15, windowMinutes: 8, audience: "coming" },
  { kind: "meeting_now", beforeMinutes: 0, windowMinutes: 5, audience: "coming" },
];

// Сколько минут осталось до встречи, если сегодня `today` и сейчас
// `nowMinutes`. Для завтрашней встречи прибавляются сутки — за сутки и
// напоминают.
export function minutesUntil(meetingDate: string, meetingMinutes: number, today: string, nowMinutes: number): number | null {
  if (meetingDate === today) return meetingMinutes - nowMinutes;
  const tomorrow = new Date(today + "T00:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (meetingDate === tomorrow.toISOString().slice(0, 10)) return meetingMinutes + (24 * 60 - nowMinutes);
  return null;
}

// Какое напоминание пора слать. Одно за раз: если из-за паузы пингера
// подошли сразу два окна, ближайшее к встрече важнее.
export function dueReminder(minutesLeft: number | null): ReminderWindow | null {
  if (minutesLeft === null) return null;
  for (const w of REMINDER_WINDOWS) {
    const from = w.beforeMinutes;
    const to = w.beforeMinutes - w.windowMinutes;
    if (w.kind === "meeting_now") {
      if (minutesLeft <= 0 && minutesLeft >= -w.windowMinutes) return w;
      continue;
    }
    if (minutesLeft <= from && minutesLeft > to) return w;
  }
  return null;
}

export function reminderHeadline(kind: ReminderKind): string {
  switch (kind) {
    case "meeting_24h":
      return "Завтра встреча";
    case "meeting_2h":
      return "Через 2 часа встреча";
    case "meeting_30m":
      return "Через 30 минут";
    case "meeting_soon":
      return "Через 15 минут";
    default:
      return "Встреча сейчас";
  }
}

// Текст участнику. Молчащего спрашивают, согласившемуся напоминают —
// одно и то же сообщение для обоих превращает вопрос в шум.
export function participantReminder(kind: ReminderKind, title: string, when: string, audience: ReminderWindow["audience"]): string {
  const head = `🔔 ${reminderHeadline(kind)}: «${title}»\n${when}`;
  if (audience === "unanswered") return `${head}\n\nВы ещё не ответили — будете?`;
  return head;
}

// Повторный вопрос тому, кто отказался молча. Не упрёк и не «ответьте
// немедленно»: человек уже сделал главное — сказал, что не придёт. Спросить
// стоит один раз за окно напоминания и словами, на которые легко ответить
// одной строкой.
export function reasonNudge(title: string, when: string): string {
  return (
    `❌ Вы отметили, что не сможете быть: «${title}»\n${when}\n\n` +
    "Напишите одним сообщением, почему — это увидит организатор. Без причины отказ ему ничего не объясняет."
  );
}

// Текст владельцу. Для ранних сроков главное не сама встреча, а кто ещё
// молчит: пока время можно двигать, это единственное, что он может решить.
export function ownerReminder(
  kind: ReminderKind,
  title: string,
  when: string,
  tally: { yes: string[]; no: { name: string }[]; pending: string[] },
): string {
  const lines = [`🔔 ${reminderHeadline(kind)}: «${title}» (${when})`];
  if (tally.yes.length) lines.push(`будут: ${tally.yes.join(", ")}`);
  if (tally.no.length) lines.push(`не смогут: ${tally.no.map((n) => n.name).join(", ")}`);
  if (tally.pending.length) lines.push(`не ответили: ${tally.pending.join(", ")}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- итог

// Через сколько минут после начала спрашивать, чем встреча кончилась.
// Два часа — не чтобы угадать длительность, а чтобы не спросить у человека,
// который ещё сидит в переговорной.
export const RECAP_AFTER_MINUTES = 120;

export type RecapKind = "meeting_recap" | "meeting_recap_day2";

// Первый вопрос — в тот же день, через два часа после начала. Второй —
// на следующее утро, если так и не ответили: встреча без итога через три
// дня попадает уже в понедельничную сводку, и это другой разговор.
export function recapDue(
  meetingDate: string,
  meetingMinutes: number,
  today: string,
  yesterday: string,
  nowMinutes: number,
  briefFromMinutes: number,
): RecapKind | null {
  if (meetingDate === today) {
    const since = nowMinutes - meetingMinutes;
    return since >= RECAP_AFTER_MINUTES ? "meeting_recap" : null;
  }
  if (meetingDate === yesterday && nowMinutes >= briefFromMinutes) return "meeting_recap_day2";
  return null;
}

export function recapAsk(kind: RecapKind, title: string, when: string): string {
  if (kind === "meeting_recap") {
    return (
      `📝 Встреча прошла: «${title}» (${when}).\n\n` +
      "Что решили? Ответьте сообщением или голосом — запишу в итог встречи."
    );
  }
  return `📝 У встречи «${title}» (${when}) до сих пор нет итога. Что решили?`;
}

// Кнопки под вопросом «как прошла встреча».
//
// Вопрос бот задавал и раньше, но ответить на него можно было только
// рассказом — а «прошла, ничего не решили» рассказом не пишут, и встреча
// оставалась открытой. Три кнопки закрывают её одним нажатием, а
// «Записать итог» остаётся для случаев, когда есть что записать.
export function recapButtons(meetingId: string): BotButton[][] {
  return [
    [
      { text: "✅ Прошла", data: encodeCallback("meeting", "mok", meetingId) },
      { text: "⚪ Без результата", data: encodeCallback("meeting", "mno", meetingId) },
    ],
    [{ text: "📝 Записать итог", data: encodeCallback("meeting", "mrec", meetingId) }],
  ];
}
