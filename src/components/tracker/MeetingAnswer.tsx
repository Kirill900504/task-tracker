"use client";

import { useState } from "react";
import type { MeetingVoteRow } from "@/hooks/useMeetingVotes";
import AnswerForm from "./AnswerForm";
import Icon from "./Icon";

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

export default function MeetingAnswer({ me, onAnswer }: { me: MeetingVoteRow | null; onAnswer: (response: "yes" | "no" | "late", reason: string) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  if (!me || me.role === "watcher") return null;

  async function run(response: "yes" | "no" | "late", reason: string) {
    setBusy(true);
    setFailed("");
    try {
      await onAnswer(response, reason);
      setAsking(false);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Не получилось ответить");
    } finally {
      setBusy(false);
    }
  }

  const said =
    me.response === "yes" ? (me.late ? "Вы предупредили, что опоздаете." : "Вы ответили: буду.") : me.response === "no" ? `Вы не сможете${me.reason ? `: ${me.reason}` : ""}.` : "";

  return (
    <div className="my-work">
      <div className="my-work-head">
        <Icon name="users" size={14} /> Вас ждут на этой встрече
      </div>

      {said && <div className="my-work-said">{said}</div>}
      {failed && <div className="ms-answer-error">{failed}</div>}

      {asking ? (
        <AnswerForm
          id="meetingDecline"
          question="Почему не получится?"
          placeholder="Что мешает прийти"
          emptyHint="Причина обязательна: без неё организатор не знает, переносить встречу или нет."
          submitLabel="Отправить"
          busy={busy}
          onSubmit={(text) => void run("no", text)}
          onCancel={() => setAsking(false)}
        />
      ) : (
        <div className="ms-actions">
          <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void run("yes", "")}>
            <Icon name="check" size={14} /> Буду
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run("late", "")}>
            <Icon name="clock" size={14} /> Опоздаю
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(true)}>
            <Icon name="ban" size={14} /> Не смогу
          </button>
        </div>
      )}
    </div>
  );
}
