"use client";

import { useEffect, useState } from "react";
import type { MeetingVoteRow } from "@/hooks/useMeetingVotes";
import AnswerForm from "./AnswerForm";
import Icon from "./Icon";
import MiniCalendar from "./MiniCalendar";
import { humanError } from "@/lib/humanError";
import { markSeen } from "@/lib/seenMark";
import { openVoteChoices } from "@/lib/answerRules";
import { WORKDAY_SLOTS, defaultMeetingStart, startsInPast } from "@/lib/meetingTime";
import { dateStr } from "@/lib/taskDisplay";

// Ваш ответ на встречу — внутри самой встречи.
//
// Жил на отдельном экране «Что от вас ждут», который Кирилл попросил
// убрать: у всех должен быть один и тот же трекер, а не список-обрубок
// сверху и настоящая карточка внизу. Отвечают там же, где встречу читают.
//
// Отказ требует причины, и это не строгость ради строгости: «не смогу» без
// слова — это то же молчание, только с нажатой кнопкой, и организатор
// узнаёт из него ровно ничего. Правило стоит и в базе, и в маршруте
// (canVoteNo), здесь оно только объясняется человеку.

// Документы к «не смогу» — приглашение на другое мероприятие, справка —
// уходят вместе с причиной (06.10.2026); кладёт их окно встречи.
export default function MeetingAnswer({
  me,
  onAnswer,
  onPropose,
}: {
  me: MeetingVoteRow | null;
  onAnswer: (response: "yes" | "no" | "late", reason: string, files: File[]) => Promise<void>;
  // Предложить другое время (07.10.2026): реплика в обсуждении встречи, на
  // которую остальные отвечают 👍 / 👎, а организатор переносит одним
  // нажатием. Нет — кнопки нет.
  onPropose?: (date: string, time: string, reason: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [sent, setSent] = useState("");
  // Новое время — по умолчанию завтра в то же время суток, что ближайший
  // свободный слот: чаще всего просят «давайте завтра».
  const [pDate, setPDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dateStr(d);
  });
  const [pTime, setPTime] = useState("10:00");
  const [pReason, setPReason] = useState("");
  // Открыл встречу, куда его позвали, — организатор увидит «видел».
  useEffect(() => {
    if (me && me.role !== "watcher") markSeen("meeting", me.id);
  }, [me]);

  if (!me || me.role === "watcher") return null;

  async function run(response: "yes" | "no" | "late", reason: string, files: File[] = []) {
    setBusy(true);
    setFailed("");
    try {
      await onAnswer(response, reason, files);
      setAsking(false);
    } catch (e) {
      setFailed(humanError(e, "Не получилось ответить"));
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    if (!onPropose) return;
    // Прошлое не предлагают — то же правило, что у самой встречи.
    if (startsInPast(pDate, pTime)) {
      setFailed("Это время уже прошло — выберите время впереди.");
      return;
    }
    setBusy(true);
    setFailed("");
    try {
      await onPropose(pDate, pTime, pReason);
      setProposing(false);
      setPReason("");
      setSent("Предложение ушло в обсуждение встречи — участники ответят 👍 или 👎, решает организатор.");
    } catch (e) {
      setFailed(humanError(e, "Не получилось отправить предложение"));
    } finally {
      setBusy(false);
    }
  }

  const said =
    me.response === "yes" ? (me.late ? "Вы предупредили, что опоздаете." : "Вы ответили: буду.") : me.response === "no" ? `Вы не сможете${me.reason ? `: ${me.reason}` : ""}.` : "";

  // Ответ даётся один раз (lib/answerRules): после «буду» остаётся только
  // «опоздаю», после «опоздаю» и «не смогу» — ничего. До 06.10.2026 гасла
  // лишь та же самая кнопка, и ответ можно было менять по кругу сколько
  // угодно. Строка голоса сюда приходит уже с учётом переноса встречи
  // (MeetingsPanel): ответ о прежнем времени считается неданным.
  const open = openVoteChoices(me);

  return (
    <div className="my-work">
      <div className="my-work-head">
        <Icon name="users" size={14} /> Вас ждут на этой встрече
      </div>

      {said && <div className="my-work-said">{said}</div>}
      {sent && <div className="my-work-said">{sent}</div>}
      {failed && <div className="ms-answer-error">{failed}</div>}

      {asking ? (
        <AnswerForm
          id="meetingDecline"
          question="Почему не получится?"
          placeholder="Что мешает прийти"
          emptyHint="Причина обязательна: без неё организатор не знает, переносить встречу или нет."
          submitLabel="Отправить"
          quick={["В это время другая встреча", "Буду в отъезде", "Заболел"]}
          busy={busy}
          onSubmit={(text, _when, files) => void run("no", text, files)}
          onCancel={() => setAsking(false)}
        />
      ) : proposing ? (
        // Предложить другое время: день, время и — по желанию — почему.
        // Время просят сеткой рабочего дня, как в самой встрече; прошедшее
        // погашено (07.10.2026, «запрети события в прошедшем времени»).
        <div className="propose-form">
          <div className="field">
            <label>Другое время</label>
            <MiniCalendar
              popover
              id="proposeDate"
              value={pDate}
              minDate={dateStr(new Date())}
              onChange={(iso) => {
                setPDate(iso);
                if (startsInPast(iso, pTime)) setPTime(defaultMeetingStart(iso, WORKDAY_SLOTS).time);
              }}
            />
          </div>
          <div className="time-grid time-grid-compact">
            {WORKDAY_SLOTS.map((slot) => {
              const past = startsInPast(pDate, slot);
              return (
                <button
                  key={slot}
                  type="button"
                  className={"time-slot" + (pTime === slot ? " selected" : "") + (past ? " past" : "")}
                  disabled={past}
                  onClick={() => setPTime(slot)}
                >
                  {slot}
                </button>
              );
            })}
          </div>
          <textarea
            className="propose-reason"
            rows={2}
            placeholder="Почему другое время (по желанию)"
            value={pReason}
            onChange={(e) => setPReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void propose();
              }
            }}
          />
          <div className="ms-actions">
            <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void propose()}>
              <Icon name="send" size={14} /> Предложить
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => setProposing(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="ms-actions">
          {open.includes("yes") && (
            <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void run("yes", "")}>
              <Icon name="check" size={14} /> Буду
            </button>
          )}
          {open.includes("late") && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run("late", "")}>
              <Icon name="clock" size={14} /> Опоздаю
            </button>
          )}
          {open.includes("no") && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(true)}>
              <Icon name="ban" size={14} /> Не смогу
            </button>
          )}
          {/* Другое время можно предложить и после ответа: «буду, но
              удобнее в три» — тоже разговор о встрече, а не отказ. */}
          {onPropose && (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => {
                setSent("");
                setProposing(true);
              }}
            >
              <Icon name="calendar" size={14} /> Предложить другое время
            </button>
          )}
        </div>
      )}
    </div>
  );
}
