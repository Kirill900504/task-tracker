import { withoutSelfMark } from "@/lib/actorName";
import { hasDeclined, type TaskParticipant } from "@/lib/taskProgress";

// Человек на задаче — кружком с буквами и состоянием работы.
//
// Слова Кирилла 13.10.2026 про кубик и про окно задачи: «с выделением кто
// финишировал выполнение работы, кто взял в работу и трудится, а кто ещё
// вообще не приступал — это всё по одной форме должно быть видно всем
// участникам процесса». Одна форма — значит одно правило на доску и на
// окно; оно здесь, а рисуют его PersonBadge и сводка задачи.

// Состояние одного человека. Порядок — по ходу работы.
export type PersonState = "done" | "declined" | "working" | "waiting" | "unreachable";

export const PERSON_STATE_LABEL: Record<PersonState, string> = {
  done: "закончил",
  declined: "не может",
  working: "в работе",
  waiting: "ещё не приступал",
  unreachable: "задача не дошла",
};

export function personState(p: Pick<TaskParticipant, "doneAt" | "declinedAt" | "acceptedAt" | "reachable">): PersonState {
  if (p.doneAt) return "done";
  if (hasDeclined(p as TaskParticipant)) return "declined";
  if (p.acceptedAt) return "working";
  // «Ждём» от человека без мессенджера — неправда: задача до него не
  // доехала (то же правило, что в TeamCompact.statusOf).
  if (p.reachable === false) return "unreachable";
  return "waiting";
}

// «Никита Козлов» → «Никита К.»: на кубике шесть полных имён не помещаются
// никак, а имя с буквой фамилии узнаётся так же быстро.
export function shortName(name: string): string {
  const words = withoutSelfMark(name).split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] || "";
  return `${words[0]} ${words[1][0]}.`;
}

export function initialsOf(name: string): string {
  const words = withoutSelfMark(name).replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Цвет из имени — тот же набор и тот же расчёт, что у автора реплики в
// обсуждении (ItemChat): один человек — один цвет во всём трекере.
const NAME_COLORS = ["#6FB1D4", "#C99BE0", "#7FC9A0", "#E0A96D", "#E08B9E", "#8FA6E8", "#5FC2C2", "#D0B45F"];

export function colorOf(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) % 100000;
  return NAME_COLORS[sum % NAME_COLORS.length];
}
