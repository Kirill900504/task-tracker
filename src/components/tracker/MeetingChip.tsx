"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import PopLayer from "./PopLayer";
import Icon from "./Icon";
import type { Meeting } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";
import { awaitsRecap } from "@/lib/calendarLogic";
import { sanitizeAssigneeList } from "@/lib/trackerRows";
import { withoutSelfMark } from "@/lib/actorName";
import { isCurrent, type MeetingVote } from "@/lib/meetingVotes";
import { openVoteChoices, type VoteChoice } from "@/lib/answerRules";
import { prefetchComments } from "@/hooks/useItemComments";
import { useAsk } from "@/components/Ask";

// Карточка встречи в списке — устроена как карточка задачи.
//
// Слова Кирилла 20.09.2026: «чтобы внешнее моделирование встреч и задач
// было однотипное по расположению ключевой информации о событии». Было не
// так: у задачи название сверху, а под ним строка фактов (кто, когда), у
// встречи же дата с временем стояли слева столбиком, участники убегали
// вправо, а три действия были значками ✓ ✕ ⇢ без единого слова — и
// крестик удаления отдельно, четвёртым, у самого края.
//
// Теперь порядок тот же, что у задачи: название, под ним строка «дата ·
// время · участники», под ней действия. Действия — с подписями: «✓» под
// встречей может значить и «прошла», и «я буду», и разницу между ними
// значком не объяснить.
//
// Подписи — по одному слову, и все три помещаются в одну строку («Успех»,
// «Провал», «Перенос», 20.09.2026). Сетка 2×2 из целых фраз занимала под
// встречей четыре строки — больше, чем сама встреча, — и повторялась у
// каждой в списке. Слово короче фразы ровно настолько, насколько оно
// понятнее: «Прошла успешно» и «Успех» отвечают на один вопрос, а второе
// читается одним взглядом.
//
// Удаление из этого ряда ушло: оно не решение по встрече, а отказ от неё,
// и стоять четвёртым среди трёх исходов ему незачем. Крестик вернулся в
// правый верхний угол карточки — то самое место, где его ищут, — но
// заметным: своя кнопка с рамкой, а не серый значок на грани видимости.
// Прежний довод «крестик у края читается как „закрыть“» снят подсказкой и
// вопросом перед удалением; довод против четвёртой кнопки в ряду —
// сильнее.

export default function MeetingChip({
  meeting,
  selectedDay,
  onOpen,
  onDelete,
  onQuickStatus,
  onQuickReschedule,
  votes,
  justCreated,
  unreadCount,
  // Моя ли это встреча. Чужую нельзя ни перенести, ни удалить, ни закрыть
  // итогом — это решения того, кто её назначил (см. MeetingsPanel).
  canManage = true,
  voteRows = [],
  myVote = null,
  onVote,
}: {
  meeting: Meeting;
  selectedDay: string | null;
  onOpen: () => void;
  onDelete: () => void;
  onQuickStatus: (status: "success" | "no_result") => void;
  onQuickReschedule: () => void;
  // Итог голосования за текущий круг: кто придёт, кто не сможет и с какой
  // причиной, кто молчит. Считается в панели — сами строки живут отдельным
  // слоем (см. useMeetingVotes).
  votes?: { yes: string[]; no: { name: string; reason: string }[]; pending: string[] };
  justCreated?: boolean;
  // Сколько новых реплик в обсуждении встречи — тот же значок, что у
  // задачи (useUnreadTaskComments).
  unreadCount?: number;
  canManage?: boolean;
  // Строки голосования этой встречи — по ним у каждого имени в подсказке
  // свой знак. Подсчёт (votes) для этого не годится: опоздавший стоит там
  // как «Имя (опоздает)», и сравнение по имени молча теряло его галочку.
  voteRows?: MeetingVote[];
  // Мой голос по этой встрече, уже с учётом переноса (currentVote). Есть —
  // значит меня позвали, и ответить можно прямо в карточке.
  myVote?: MeetingVote | null;
  onVote?: (choice: VoteChoice) => void;
}) {
  // The participants tooltip lives in <body> and is positioned from the
  // anchor's rect, exactly as legacy's showPeopleTooltip() did: the meetings
  // list scrolls (#meetingsForDay{overflow:auto}), so a tooltip nested inside
  // a chip gets clipped for meetings near the bottom of the list.
  const [peopleAnchor, setPeopleAnchor] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const participants = sanitizeAssigneeList(meeting.participants);
  // Who answered «Буду» in Telegram — shown against the participant count,
  // so a glance says how many are actually coming.
  const confirmed = (meeting.confirmedBy || []).filter((name) => participants.includes(name));
  // Предложенная встреча времени ещё не занимает, и выглядеть как
  // назначенная не должна — иначе её станут считать состоявшейся
  // договорённостью, каковой она не является.
  const proposed = meeting.status === "proposed";
  // Прошла, а чем кончилась — не сказано. Пока итога нет, встреча не
  // уходит из списка: она ещё требует одного действия.
  const waitingRecap = awaitsRecap(meeting);
  const showQuickActions = canManage && (!meeting.status || meeting.status === "planned" || waitingRecap);
  const round = meeting.voteRound || 1;
  const live = !meeting.status || meeting.status === "planned" || meeting.status === "proposed";

  // Позвали — отвечают здесь же, не открывая встречу.
  //
  // Слова Кирилла 07.10.2026: «когда человек приглашённый гость, нужно
  // сразу добавить кнопки подтверждения участия или „не смогу“ прямо в
  // прямоугольничках». Ряд тот же, что у организатора («Успех / Провал /
  // Перенос»): у карточки один ряд действий, а чьи это действия, решает
  // то, кто на неё смотрит. Прошедшей встрече отвечать уже не о чем.
  const canVote = !!onVote && !!myVote && myVote.role !== "watcher" && live && !waitingRecap && !showQuickActions;
  const choices: VoteChoice[] = canVote ? openVoteChoices(myVote, round) : [];
  const mySaid = canVote && myVote && myVote.response !== "none" && isCurrent(myVote, round) ? myVote : null;

  // Прошла, итога нет, а встреча чужая: закрыть её участник не может, и
  // плашка «нужен итог» висит у него до тех пор, пока не вспомнит
  // организатор. Кнопка отдаёт вопрос тому, кто может ответить, — шуткой в
  // мессенджер (/api/workspace/recap-nudge, 07.10.2026: «это для
  // участников встречи, так как сами то они прошедшие встречи скрыть не
  // могут»). Ответ — рядом с кнопкой, в её же подписи: «Напомнили».
  const ask = useAsk();
  const canNudge = waitingRecap && !canManage;
  const [nudge, setNudge] = useState<"idle" | "sending" | "sent">("idle");
  async function nudgeOrganizer() {
    setNudge("sending");
    try {
      const res = await fetch("/api/workspace/recap-nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: meeting.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; already?: boolean; minutes?: number };
      if (!res.ok) throw new Error(data.error || "Не получилось напомнить");
      setNudge("sent");
      if (data.already) {
        await ask.say({
          title: "Уже напомнили",
          question: `Организатору уже напоминали ${data.minutes} мин назад — это видно в обсуждении встречи. Следующее напоминание можно отправить через три часа после прошлого.`,
        });
      }
    } catch (err) {
      setNudge("idle");
      await ask.say({ title: "Не получилось", question: err instanceof Error ? err.message : String(err) });
    }
  }

  // Знак у имени в подсказке — по строке голоса, а не по подсчёту.
  function stateOf(name: string): "yes" | "late" | "no" | "none" | "unknown" {
    const row = voteRows.find((v) => v.name === name);
    if (!row) return votes ? "none" : confirmed.includes(name) ? "yes" : "unknown";
    if (row.response === "none" || !isCurrent(row, round)) return "none";
    if (row.response === "no") return "no";
    return row.late ? "late" : "yes";
  }

  // Все позванные сказали «буду» — встреча собрана; хоть один «не смогу» —
  // организатору есть о чём подумать. Корешком у левого края, как роль у
  // задачи: полоску узнают не сравнивая, а рамка вокруг карточки уже
  // занята выбранным днём (07.10.2026: «выделяй лёгкой зелёной рамкой или
  // какой-нибудь приятной пометкой… а где один или более не может —
  // аналогичным не раздражающим маркером»).
  const gathered = live && !!votes && votes.no.length === 0 && votes.pending.length === 0 && votes.yes.length > 0;
  const someoneOut = live && !!votes && votes.no.length > 0;

  // Placed by writing to the DOM once it has been measured (its own size
  // decides whether it fits below the anchor), before paint — the same
  // getBoundingClientRect math legacy's showPeopleTooltip() used.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!peopleAnchor || !el) return;
    let top = peopleAnchor.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) top = peopleAnchor.top - el.offsetHeight - 4;
    el.style.top = top + "px";
    el.style.left = Math.max(8, peopleAnchor.right - el.offsetWidth) + "px";
  }, [peopleAnchor]);

  // Встречу несут на день календаря — это перенос. Порядок в списке у встреч
  // свой (по времени), переставлять их руками нечего, поэтому draggable, а
  // не sortable.
  //
  // Чужую не несут вовсе: перенос — право того, кто назначил, и карточка,
  // которая поднимается и не ложится, объясняет ровно столько же, сколько
  // перечёркнутый круг, то есть ничего.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "meeting:" + meeting.id,
    disabled: !canManage,
    data: { payload: { kind: "meeting", id: meeting.id, title: meeting.title } },
  });

  return (
    <div
      className={
        "meeting-chip" +
        (meeting.date === selectedDay ? " selected-day" : "") +
        (meeting.status && meeting.status !== "planned" ? " resolved" : "") +
        (waitingRecap ? " awaits-recap" : "") +
        (justCreated ? " just-created" : "") +
        (isDragging ? " dragging" : "") +
        (canManage ? "" : " readonly") +
        (gathered ? " all-in" : "") +
        (someoneOut ? " has-decline" : "")
      }
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // Обсуждение просится заранее — пока мышь на карточке, до нажатия:
      // окно встречи открывается уже с перепиской (07.10.2026, «на долю
      // секунды появляется пустой чат»).
      onPointerEnter={() => prefetchComments("meeting", meeting.id)}
      onClick={onOpen}
    >
      <div className="meeting-body">
        <div className="meeting-head">
          <span className="mtitle">{meeting.title}</span>
          {!!unreadCount && (
            <span className="task-mark unread" title={`${unreadCount} новых сообщений в обсуждении`}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          {meeting.status === "success" && (
            <span className="mstatus success" title="Успешно завершена">
              <Icon name="check" size={14} />
            </span>
          )}
          {meeting.status === "no_result" && (
            <span className="mstatus no_result" title={meeting.movedToDate ? "Перенесена на " + fmtDate(meeting.movedToDate) : "Без результата"}>
              <Icon name="ban" size={14} />
            </span>
          )}
        </div>

        {/* Строка фактов — то же место, что у задачи занимают исполнитель и
            срок: когда это, во сколько и сколько человек идёт. */}
        <div className="meeting-meta">
          <span className="mdate">{fmtDate(meeting.date)}</span>
          <span className="mtime">{meeting.time || "--:--"}</span>
          {participants.length > 0 && (
            <span
              className="mpeople"
              onMouseEnter={(e) => setPeopleAnchor(e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setPeopleAnchor(null)}
            >
              <Icon name="users" size={13} /> {votes ? `${votes.yes.length}/${participants.length}` : confirmed.length > 0 ? `${confirmed.length}/${participants.length}` : participants.length}
              {votes && votes.no.length > 0 && <span className="mpeople-no"> · {votes.no.length} не смогут</span>}
            </span>
          )}
          {proposed && <span className="pill pill-proposed">предложена</span>}
          {waitingRecap && <span className="pill pill-recap">нужен итог</span>}
        </div>

        {/* Три исхода встречи, каждый одним словом и все в одну строку.
            Значки ✓ ✕ ⇢ стояли здесь раньше и читались только тем, кто уже
            знает, что они значат; целые фразы, пришедшие им на смену,
            читались сразу, но занимали под каждой встречей четыре строки.
            Полное название осталось подсказкой — она отвечает на «успех
            чего?», когда такой вопрос возникает. */}
        {/* Свой ответ — тем же рядом, где у организатора исходы. Уже
            ответил — отметка, что именно, и то, что ещё можно (после
            «буду» — «опоздаю», дальше ничего: ответ даётся один раз). */}
        {canVote && (choices.length > 0 || mySaid) && (
          <div className="meeting-actions vote">
            {mySaid && (
              <span className={"meeting-my-vote " + (mySaid.response === "no" ? "no" : mySaid.late ? "late" : "yes")}>
                <Icon name={mySaid.response === "no" ? "close" : mySaid.late ? "clock" : "check"} size={13} />
                {mySaid.response === "no" ? "Не смогу" : mySaid.late ? "Опоздаю" : "Буду"}
              </span>
            )}
            {choices.includes("yes") && (
              <button
                className="meeting-act vote-yes"
                title="Подтвердить участие"
                onClick={(e) => {
                  e.stopPropagation();
                  onVote?.("yes");
                }}
              >
                Буду
              </button>
            )}
            {choices.includes("late") && (
              <button
                className="meeting-act vote-late"
                title="Приду, но позже начала"
                onClick={(e) => {
                  e.stopPropagation();
                  onVote?.("late");
                }}
              >
                Опоздаю
              </button>
            )}
            {choices.includes("no") && (
              <button
                className="meeting-act vote-no"
                title="Не смогу — спросим причину, её увидят в обсуждении встречи"
                onClick={(e) => {
                  e.stopPropagation();
                  onVote?.("no");
                }}
              >
                Не смогу
              </button>
            )}
          </div>
        )}

        {canNudge && (
          <div className="meeting-actions">
            <button
              className="meeting-act"
              title="Организатору придёт шуточное напоминание подвести итог"
              disabled={nudge !== "idle"}
              onClick={(e) => {
                e.stopPropagation();
                void nudgeOrganizer();
              }}
            >
              {nudge === "sent" ? "Напомнили" : "Напомнить"}
            </button>
          </div>
        )}

        {showQuickActions && (
          <div className="meeting-actions">
            <button
              className="meeting-act success"
              title="Встреча прошла успешно"
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatus("success");
              }}
            >
              Успех
            </button>
            <button
              className="meeting-act noresult"
              title="Встреча прошла без результата"
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatus("no_result");
              }}
            >
              Провал
            </button>
            <button
              className="meeting-act reschedule"
              title="Перенести встречу на другой день"
              onClick={(e) => {
                e.stopPropagation();
                onQuickReschedule();
              }}
            >
              Перенос
            </button>
          </div>
        )}
      </div>

      {/* Отмена встречи — в правом верхнем углу, где её и ищут. Заметной
          кнопкой, а не значком, проступающим на наведение: наведения нет
          на телефоне вовсе, и невидимая кнопка равна отсутствующей.
          Спрашивает причину перед отменой, поэтому промах пальцем ничего
          не стоит. */}
      {showQuickActions && (
        <button
          className="meeting-del"
          title={`Отменить встречу «${meeting.title}»`}
          aria-label="Отменить встречу"
          onClick={(e) => {
            e.stopPropagation();
            // Спрашивает сам обработчик — причину отмены (MeetingsPanel).
            onDelete();
          }}
        >
          <Icon name="close" size={15} />
        </button>
      )}

      {peopleAnchor && (
        <PopLayer>
          <div ref={tooltipRef} id="peopleTooltip" className="people-tooltip" style={{ display: "block", top: -9999, left: -9999 }}>
            {/* Отказ и молчание — разные вещи, и именно эта разница нужна,
                чтобы понимать, кого ещё спрашивать. Знаки цветные
                (07.10.2026: «галочки или крестики сделай цветными и
                выразительными, чтобы сразу бросалось в глаза»).
                Причины отказа здесь больше нет — его же словами, «тут он
                как раз не нужен вовсе»: она лежит в обсуждении встречи,
                рядом с отметкой об отказе. */}
            {participants.map((p) => {
              const state = stateOf(p);
              return (
                <div className={"prow vote-" + state} key={p}>
                  <span className="prow-mark" aria-hidden>
                    {state === "yes" ? (
                      <Icon name="check" size={13} />
                    ) : state === "no" ? (
                      <Icon name="close" size={13} />
                    ) : state === "late" ? (
                      <Icon name="clock" size={13} />
                    ) : state === "none" ? (
                      "•"
                    ) : null}
                  </span>
                  {withoutSelfMark(p)}
                </div>
              );
            })}
          </div>
        </PopLayer>
      )}
    </div>
  );
}
