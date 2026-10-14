"use client";

import { useState } from "react";
import type { ApprovalState } from "@/types/tracker";
import { taskProgress, taskStage } from "@/lib/taskProgress";
import type { Participant } from "@/hooks/useTaskParticipants";
import { useAsk } from "@/components/Ask";
import { answerWithFiles } from "@/lib/answerFiles";
import { withoutSelfMark } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";

// Решения постановщика по задаче — одним блоком сразу под шапкой окна.
//
// Слова Кирилла 24.09.2026: «блоки, призывающие к действию для
// постановщика… должны идти сразу за описанием задачи… Не правильно, когда
// за тем, чтобы отреагировать на исполнение поставленной тобой задачи
// другому человеку, приходится опускаться в середину окна». Здесь просьбы
// о переносе, приёмка, «открыть заново» и строка о возврате.
//
// Состава здесь больше нет (13.10.2026): он живёт в сводке задачи
// (TaskPeople) — с этапом каждого, кнопкой «+», сменой роли и «вернуть
// ему одному». «Этот блок с дурацким названием „кто на задаче“ дублирует
// блок со статусом, постановщиком и исполнителем… его предлагаю вообще
// убрать». Ушло и «Закрыть волевым решением» — теперь это «Принудительное
// закрытие» в шапке окна (TaskModal), одна кнопка на всё окно, а не по
// одной на каждую стадию.

export default function TeamCompact({
  taskId,
  participants,
  approvalState,
  approvalComment,
  onApproveWork,
  onReturnWork,
  onReopenWork,
  onCloseUnfulfilled,
  onAcceptReschedule,
  onRejectReschedule,
  closed = false,
}: {
  // Нужен документам к решению: они ложатся в обсуждение задачи
  // (lib/answerFiles).
  taskId: string;
  participants: Participant[];
  approvalState: ApprovalState;
  approvalComment?: string;
  onApproveWork: (comment: string) => void | Promise<void>;
  onReturnWork: (comment: string) => void | Promise<void>;
  onReopenWork: (comment: string) => void | Promise<void>;
  // Тот же маршрут, что «Принудительное закрытие» в шапке (action force);
  // сервер сам называет такое закрытие «невыполненной», раз отчётов нет.
  onCloseUnfulfilled: (comment: string) => void | Promise<void>;
  onAcceptReschedule: (participantId: string, date: string) => void;
  onRejectReschedule: (participantId: string) => void;
  // Закрытая задача — только просмотр: просьба о переносе срока у неё уже
  // ни о чём, остаётся одно «Открыть заново».
  closed?: boolean;
}) {
  const ask = useAsk();
  const identity = useWorkspaceRole();
  // Пометка «(я)» не показывается никому, владельцу тоже (24.09.2026).
  const shown = (name: string) => withoutSelfMark(name);

  const progress = taskProgress(participants);
  const stage = taskStage(participants, approvalState);

  // Приёмка, возврат и открытие заново двигают задачу и после успеха
  // закрывают карточку — но только когда ответ сети ВЕРНУЛСЯ. busy не даёт
  // второму нажатию за это время отправить то же решение ещё раз с другим
  // текстом («два раза закрыть с разными комментариями», 24.09.2026).
  const [busy, setBusy] = useState(false);

  async function handleApprove() {
    if (busy) return;
    const answer = await ask.askWithFiles({
      title: "Приёмка работы",
      question: "Комментарий к приёмке",
      note: "Его увидят исполнители — подтвердите, что именно принимаете.",
      multiline: true,
      okText: "Принять",
      // Обязателен — как и у возврата, и у принудительного закрытия. До
      // 23.09.2026 можно было принять чужую работу пустым нажатием: слова
      // Кирилла — «закрыл успешно без заполнения финального комментария.
      // Это по-хорошему ошибка».
      required: "Приёмка без комментария не решение — напишите хотя бы, что именно принимаете.",
    });
    if (answer === null || busy) return;
    const comment = answer.text;
    setBusy(true);
    try {
      await answerWithFiles({ kind: "task", id: taskId }, answer.files, "Документы к приёмке", () => onApproveWork(comment.trim()));
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn() {
    if (busy) return;
    const answer = await ask.askWithFiles({
      title: "Вернуть на доработку",
      question: "Что доделать?",
      note: "Это увидят исполнители — и это единственное, что объясняет возврат.",
      multiline: true,
      okText: "Вернуть",
      required: "Возврат без объяснения бессмысленен — напишите, что не так.",
    });
    if (answer === null || busy) return;
    const comment = answer.text;
    setBusy(true);
    try {
      await answerWithFiles({ kind: "task", id: taskId }, answer.files, "Документы к возврату на доработку", () => onReturnWork(comment.trim()));
    } finally {
      setBusy(false);
    }
  }

  // «Закрыть невыполненной» — 14.10.2026, его слова: исполнитель сказал «не
  // могу», и если постановщик «реально понимает, что причина невыполнения
  // уважительная», он закрывает задачу без результата, и «при закрытии так
  // же обязателен заключительный комментарий постановщика». Кнопка вверху
  // окна делала то же самое, но стояла далеко от вопроса и называлась
  // словом, которое читается как наказание, а не как согласие с причиной.
  async function handleCloseUnfulfilled() {
    if (busy) return;
    const answer = await ask.askWithFiles({
      title: "Закрыть невыполненной",
      question: "Заключительный комментарий",
      note: "Задача закроется без результата. Комментарий увидят исполнители — напишите, почему закрываете.",
      multiline: true,
      okText: "Закрыть невыполненной",
      required: "Без заключительного комментария закрыть нельзя — напишите, почему закрываете.",
    });
    if (answer === null || busy) return;
    const comment = answer.text;
    setBusy(true);
    try {
      await answerWithFiles({ kind: "task", id: taskId }, answer.files, "Документы к закрытию невыполненной", () => onCloseUnfulfilled(comment.trim()));
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (busy) return;
    const answer = await ask.askWithFiles({
      title: "Открыть задачу заново",
      question: "Что изменилось?",
      note: "Можно оставить пустым. Отчёты исполнителей никуда не денутся — задача вернётся туда, где была до приёмки, и по ней можно отчитаться заново.",
      multiline: true,
      okText: "Открыть заново",
    });
    if (answer === null || busy) return;
    const comment = answer.text;
    setBusy(true);
    try {
      await answerWithFiles({ kind: "task", id: taskId }, answer.files, "Документы к открытию заново", () => onReopenWork(comment.trim()));
    } finally {
      setBusy(false);
    }
  }

  const asks = closed ? [] : participants.filter((p) => p.rescheduleTo || p.rescheduleReason);
  // Своя задача: единственный исполнитель — тот, кто её поставил. Приёмки у
  // самого себя нет — сервер закрывает такую задачу сам, как только пришёл
  // отчёт (closeIfEveryoneReported). Но строки участия доезжают сюда раньше,
  // чем закрытие, и на эти секунды окно спрашивало «Принимаете работу?» —
  // вопрос, которого нет (QA-проход 06.10.2026).
  const executorsNow = participants.filter((p) => p.role === "executor");
  const selfOnly =
    executorsNow.length === 1 &&
    (identity.assigneeId ? executorsNow[0].assigneeId === identity.assigneeId : isSelfAssignee(executorsNow[0].name || ""));
  const closingOwn = selfOnly && progress.doneCount === 1 && progress.declined.length === 0;
  const returned = stage === "returned" && !!approvalComment;
  const nothingHandedIn = progress.total > 0 && progress.doneCount === 0 && progress.declined.length === 0;

  if (!asks.length && !returned && stage !== "awaiting_review" && stage !== "done") return null;

  return (
    <div className="field team-decisions" id="taskDecisions">
      {returned && <div className="tp-returned">Возвращено на доработку: {approvalComment}</div>}

      {/* Просьбы о переносе — первыми: решение, которого ждут прямо сейчас. */}
      {asks.map((p) => (
        <div className="tp-ask" key={"ask-" + p.id}>
          <div className="tp-ask-text">
            <b>{shown(p.name)}</b> просит перенести
            {p.rescheduleTo ? ` на ${p.rescheduleTo.split("-").reverse().join(".")}` : ""}
            {p.rescheduleReason ? `: ${p.rescheduleReason}` : ""}
          </div>
          <div className="tp-ask-actions">
            {p.rescheduleTo && (
              <button className="btn btn-small btn-primary" type="button" onClick={() => onAcceptReschedule(p.id, p.rescheduleTo!)}>
                Перенести
              </button>
            )}
            <button className="btn btn-small" type="button" onClick={() => onRejectReschedule(p.id)}>
              Оставить как есть
            </button>
          </div>
        </div>
      ))}

      {stage === "awaiting_review" && closingOwn && (
        <div className="tp-review">
          <div className="tp-review-text">Вы отчитались по своей задаче.</div>
          {/* Обычно сервер закрывает её сам за секунду. Кнопка — выход на
              случай, когда этого не случилось: без неё блок был бы тупиком. */}
          <div className="tp-review-actions">
            <button className="btn btn-small btn-primary" type="button" disabled={busy} onClick={() => void handleApprove()}>
              Закрыть задачу
            </button>
          </div>
        </div>
      )}

      {/* Отчёт сняли возвратом, а новый ещё не пришёл: решать нечего, и
          второй «Вернуть» был бы вторым сообщением о том же самом
          (14.10.2026 — задачу вернули трижды за два отчёта). Сервер это
          тоже запрещает (applyReview); здесь — чтобы кнопки не было. */}
      {stage === "awaiting_review" && !closingOwn && !nothingHandedIn && (
        <div className="tp-review">
          <div className="tp-review-text">
            {progress.declined.length === 0
              ? "Все исполнители отчитались. Принимаете работу?"
              : progress.doneCount === 0
                ? `Работу не сделают: ${progress.declined.map((d) => shown(d.name)).join(", ")}. Решать вам — вернуть с объяснением или закрыть невыполненной.`
                : `Отчитались не все: ${progress.declined.map((d) => shown(d.name)).join(", ")} не смогут. Решать вам.`}
          </div>
          <div className="tp-review-actions">
            {progress.doneCount > 0 && (
              <button className="btn btn-small btn-primary" type="button" disabled={busy} onClick={() => void handleApprove()}>
                Принять
              </button>
            )}
            <button className="btn btn-small" type="button" disabled={busy} onClick={() => void handleReturn()}>
              {progress.declined.length ? "Вернуть с объяснением" : "Вернуть на доработку"}
            </button>
            {/* Только когда сдавать нечего: если хоть один отчёт есть, решение
                — «Принять» (с комментарием о том, кто не смог). */}
            {progress.declined.length > 0 && progress.doneCount === 0 && (
              <button className="btn btn-small" type="button" id="closeUnfulfilledBtn" disabled={busy} onClick={() => void handleCloseUnfulfilled()}>
                Закрыть невыполненной
              </button>
            )}
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className="tp-review">
          <div className="tp-review-text">Задача принята и закрыта.</div>
          <div className="tp-review-actions">
            <button className="btn btn-small" type="button" disabled={busy} onClick={() => void handleReopen()}>
              Открыть заново
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
