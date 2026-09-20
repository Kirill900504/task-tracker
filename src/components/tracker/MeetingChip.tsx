"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import PopLayer from "./PopLayer";
import type { Meeting } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";
import { awaitsRecap } from "@/lib/calendarLogic";
import { sanitizeAssigneeList } from "@/lib/trackerRows";
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
// значком не объяснить. Подписи стоят сеткой 2×2, а не общим flex-wrap:
// панель узкая, и перенос по месту рвал бы ряд каждый раз в новом месте.

export default function MeetingChip({
  meeting,
  selectedDay,
  onOpen,
  onDelete,
  onQuickStatus,
  onQuickReschedule,
  votes,
  justCreated,
  // Моя ли это встреча. Чужую нельзя ни перенести, ни удалить, ни закрыть
  // итогом — это решения того, кто её назначил (см. MeetingsPanel).
  canManage = true,
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
  canManage?: boolean;
}) {
  // The participants tooltip lives in <body> and is positioned from the
  // anchor's rect, exactly as legacy's showPeopleTooltip() did: the meetings
  // list scrolls (#meetingsForDay{overflow:auto}), so a tooltip nested inside
  // a chip gets clipped for meetings near the bottom of the list.
  const ask = useAsk();
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
        (canManage ? "" : " readonly")
      }
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      <div className="meeting-body">
        <div className="meeting-head">
          <span className="mtitle">{meeting.title}</span>
          {meeting.status === "success" && (
            <span className="mstatus success" title="Успешно завершена">
              ✅
            </span>
          )}
          {meeting.status === "no_result" && (
            <span className="mstatus no_result" title={meeting.movedToDate ? "Перенесена на " + fmtDate(meeting.movedToDate) : "Без результата"}>
              🚫
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
              👥 {votes ? `${votes.yes.length}/${participants.length}` : confirmed.length > 0 ? `${confirmed.length}/${participants.length}` : participants.length}
              {votes && votes.no.length > 0 && <span className="mpeople-no"> · {votes.no.length} не смогут</span>}
            </span>
          )}
          {proposed && <span className="pill pill-proposed">предложена</span>}
          {waitingRecap && <span className="pill pill-recap">нужен итог</span>}
        </div>

        {/* Четыре решения по встрече, все со словами. Значки ✓ ✕ ⇢ стояли
            здесь раньше и читались только тем, кто уже знает, что они
            значат; крестик удаления при этом жил отдельно у края карточки
            и выглядел как «закрыть», а не как «удалить». */}
        {showQuickActions && (
          <div className="meeting-actions">
            <button
              className="meeting-act success"
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatus("success");
              }}
            >
              Прошла успешно
            </button>
            <button
              className="meeting-act noresult"
              onClick={(e) => {
                e.stopPropagation();
                onQuickStatus("no_result");
              }}
            >
              Без результата
            </button>
            <button
              className="meeting-act reschedule"
              onClick={(e) => {
                e.stopPropagation();
                onQuickReschedule();
              }}
            >
              Перенести
            </button>
            <button
              className="meeting-act danger"
              onClick={(e) => {
                e.stopPropagation();
                void (async () => {
                  const yes = await ask.confirm({ question: `Удалить встречу «${meeting.title}»?`, okText: "Удалить", danger: true });
                  if (yes) onDelete();
                })();
              }}
            >
              Удалить встречу
            </button>
          </div>
        )}
      </div>

      {peopleAnchor && (
        <PopLayer>
          <div ref={tooltipRef} id="peopleTooltip" className="people-tooltip" style={{ display: "block", top: -9999, left: -9999 }}>
            {/* Отказ и молчание — разные вещи, и именно эта разница нужна,
                чтобы понимать, кого ещё спрашивать. */}
            {participants.map((p) => {
              const said = votes?.no.find((n) => n.name === p);
              const coming = votes ? votes.yes.includes(p) : confirmed.includes(p);
              return (
                <div className="prow" key={p}>
                  {coming ? "✅ " : said ? "❌ " : votes ? "· " : ""}
                  {p}
                  {/* Отказ без причины — не то же самое, что отказ с
                      причиной, и молчать об этом в списке значит выдавать
                      половину ответа за целый. Бот причину спрашивает и
                      переспрашивает, но увидеть, что её пока нет, нужно
                      здесь. */}
                  {said ? (said.reason ? ` — ${said.reason}` : " — причину не назвал") : ""}
                </div>
              );
            })}
          </div>
        </PopLayer>
      )}
    </div>
  );
}
