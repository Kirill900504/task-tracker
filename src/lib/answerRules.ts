// Ответ даётся один раз. Что после него ещё можно нажать.
//
// 06.10.2026, слова Кирилла: «во встрече можно сто раз поменять своё
// решение, написать что буду, потом что не буду, потом опоздаю, потом
// опять не буду и развлекаться так до бесконечности… Когда нажимается
// кнопка, возможность нажать другое должна исчезать, кроме возможности
// предупредить об опоздании».
//
// До этого смена ответа была решением проекта («передумать можно до
// начала»), и бот прямо писал под каждым ответом «нажмите другую кнопку».
// Цена этой свободы — ответ, которому нельзя верить: организатор планирует
// встречу по «буду», а через минуту оно уже «не смогу», и в обсуждении
// копится лента из «будет / не сможет / будет». Ответ — это обязательство,
// а не положение переключателя. Если планы правда изменились, об этом
// говорят словами в обсуждении, и решает организатор (или постановщик) —
// так же, как с отказом, на который он отвечает, переговорив с человеком.
//
// Правило живёт здесь, а не в кнопках, потому что дверей три — окно
// трекера, маршрут /api/workspace/report и кнопки бота (у коллеги и у
// владельца одна функция, colleagueReplies), — а обходить запрет, который
// стоит только в интерфейсе, можно старой кнопкой под сообщением бота,
// присланным до того, как запрет появился.

export type VoteChoice = "yes" | "late" | "no";

export type MyVote = {
  response: "none" | "yes" | "no";
  late?: boolean | null;
  round?: number | null;
};

const ALL_VOTES: VoteChoice[] = ["yes", "late", "no"];

function voteRoundOf(v: MyVote): number {
  return Number(v.round ?? 1) || 1;
}

// Ответ, данный до переноса встречи, о новом времени не говорит ничего —
// перенос открывает выбор заново (см. isCurrent в meetingVotes).
function hasVoted(v: MyVote | null | undefined, round: number): v is MyVote {
  return !!v && v.response !== "none" && voteRoundOf(v) >= round;
}

// Какие ответы на встречу ещё можно дать.
//   не отвечал          — все три;
//   «буду»              — только «опоздаю»: это уточнение к «буду», а не
//                         смена решения, и узнать о пробке человек может
//                         и за пять минут до начала;
//   «опоздаю», «не смогу» — ничего.
export function openVoteChoices(v: MyVote | null | undefined, round = 1): VoteChoice[] {
  if (!hasVoted(v, round)) return ALL_VOTES;
  if (v.response === "yes" && !v.late) return ["late"];
  return [];
}

// Строка голоса, какой её должна видеть карточка: ответ о прежнем времени
// превращается в неданный, иначе после переноса человек видел бы «Вы
// ответили: не смогу» про время, которого больше нет, и ни одной кнопки.
export function currentVote<T extends MyVote & { reason?: string | null }>(v: T | null, round: number): T | null {
  if (!v || v.response === "none" || voteRoundOf(v) >= round) return v;
  return { ...v, response: "none", late: false, reason: null };
}

export function choiceOf(v: MyVote): VoteChoice {
  return v.response === "no" ? "no" : v.late ? "late" : "yes";
}

// Что делать с пришедшим нажатием:
//   ok     — записать;
//   same   — тот же ответ ещё раз (старая кнопка, двойной щелчок): не
//            ошибка и не событие, ответить «принято» и ничего не писать;
//   locked — ответ уже дан, смена запрещена.
export function voteVerdict(v: MyVote | null | undefined, next: VoteChoice, round = 1): "ok" | "same" | "locked" {
  if (hasVoted(v, round) && choiceOf(v) === next) return "same";
  return openVoteChoices(v, round).includes(next) ? "ok" : "locked";
}

// Что сказать человеку, который нажал запрещённое.
export function lockedVoteText(v: MyVote): string {
  const said = choiceOf(v) === "no" ? "«не смогу»" : choiceOf(v) === "late" ? "«опоздаю»" : "«буду»";
  return `Вы уже ответили ${said}. Если планы изменились — напишите организатору в обсуждении встречи.`;
}

// То же для задачи. Здесь ответов два — «Сделал» и «Не могу», — и оба
// окончательные: отчёт уводит задачу на приёмку, отказ тоже (taskProgress.
// allAnswered), и дальше слово за постановщиком. Открыть ответ заново
// может только он — возвратом на доработку, который стирает и отчёт, и
// отказ (reviewWork). «Принял» и «Прошу перенос» — не ответы, а шаги по
// дороге к ним; повторять их незачем, поэтому и они гаснут, как только
// сделаны: каждое повторное нажатие писало в хронику ещё одну строку.
export type MyTaskPart = {
  acceptedAt?: string | null;
  doneAt?: string | null;
  declinedAt?: string | null;
  // Просьба о переносе ждёт решения постановщика. Неполная просьба из бота
  // (дату выбрали, причину ещё не написали) сюда НЕ считается: человек
  // вправе передумать о дате, пока не объяснил её.
  reschedulePending?: boolean;
};

export type TaskChoices = { accept: boolean; done: boolean; decline: boolean; move: boolean };

export function openTaskChoices(p: MyTaskPart | null | undefined): TaskChoices {
  const answered = !!p?.doneAt || !!p?.declinedAt;
  return {
    accept: !answered && !p?.acceptedAt,
    done: !answered,
    decline: !answered,
    move: !answered && !p?.reschedulePending,
  };
}

export function lockedTaskText(p: MyTaskPart): string {
  if (p.doneAt) return "Вы уже отчитались по этой задаче — решение за постановщиком.";
  if (p.declinedAt) return "Вы уже отказались от этой задачи — решение за постановщиком.";
  if (p.reschedulePending) return "Просьба о переносе уже у постановщика — ждём его решения.";
  return "Вы уже приняли эту задачу в работу.";
}
