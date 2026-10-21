"use client";

import { useState } from "react";
import type { ApprovalState } from "@/types/tracker";
import { hasDeclined, taskProgress, taskStage } from "@/lib/taskProgress";
import type { Participant } from "@/hooks/useTaskParticipants";
import { useAsk } from "@/components/Ask";
import { answerWithFiles } from "@/lib/answerFiles";
import { withoutSelfMark } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { QUICK_APPROVE, QUICK_CLOSE_UNFULFILLED, QUICK_RETURN } from "@/lib/quickAnswers";

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
  onWaitForAll,
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
  // participantIds — кому именно вернуть (строки участия). Без них — всем,
  // кто ответил: так у задачи на одного исполнителя.
  onReturnWork: (comment: string, participantIds?: string[]) => void | Promise<void>;
  // «Дождаться всех»: сдали целиком, а отчёт нужен от каждого.
  onWaitForAll?: () => void | Promise<void>;
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
      quick: QUICK_APPROVE,
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

  // Вернуть можно только ответившим — отчёт или отказ, то, что возврат и
  // снимает. Кто ещё молчит, тот и так в работе.
  const answeredExecutors = participants.filter((p) => p.role === "executor" && (p.doneAt || hasDeclined(p)));

  async function handleReturn() {
    if (busy) return;
    // Кому вернуть — выбирает постановщик (21.10.2026, задача №111):
    // возврат снимал отчёты у всех, и трое, чьей работой он был доволен,
    // снова видели «Сделал». Один ответивший — выбирать не из чего, и
    // вопроса «кому» нет вовсе. Несколько — никто не отмечен заранее:
    // возврат стоит человеку переделанной работы, и решение «кому» должно
    // быть нажатием, а не согласием с подстановкой.
    const several = answeredExecutors.length > 1;
    const answer = await ask.askWithFiles({
      title: "Вернуть на доработку",
      question: "Что доделать?",
      note: several
        ? "Отчёты тех, кого не отметили, останутся принятыми — им ничего переделывать не придётся. Объяснение увидят те, кому возвращаете."
        : "Это увидят исполнители — и это единственное, что объясняет возврат.",
      multiline: true,
      okText: "Вернуть",
      quick: QUICK_RETURN,
      required: "Возврат без объяснения бессмысленен — напишите, что не так.",
      pick: several
        ? {
            label: "Кому вернуть",
            options: answeredExecutors.map((p) => ({ value: p.id, label: shown(p.name), hint: p.doneAt ? "сдал" : "не может" })),
            selected: [],
            required: "Отметьте, кому вернуть на доработку.",
          }
        : undefined,
    });
    if (answer === null || busy) return;
    const comment = answer.text;
    // Отмечены все ответившие — это обычный возврат, без списка.
    const ids = several && answer.picked.length < answeredExecutors.length ? answer.picked : undefined;
    setBusy(true);
    try {
      await answerWithFiles({ kind: "task", id: taskId }, answer.files, "Документы к возврату на доработку", () => onReturnWork(comment.trim(), ids));
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
      quick: QUICK_CLOSE_UNFULFILLED,
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

  // «Дождаться всех» — без вопроса: решение не требует объяснения, ничьих
  // ответов не снимает, а тем, кого ждут, сервер говорит сам.
  async function handleWait() {
    if (busy || !onWaitForAll) return;
    setBusy(true);
    try {
      await onWaitForAll();
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
  // На приёмке, а кто-то из исполнителей ещё молчит — значит, задачу сдали
  // целиком (closeIfEveryoneReported, whole). Только тогда есть кого ждать.
  const waitable = progress.doneCount > 0 && progress.pendingNames.length > 0;

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
            {/* Кто-то ещё не ответил, а задача на приёмке — значит, её сдали
                целиком (закрытие «за всех», closeIfEveryoneReported). Писать
                здесь «все отчитались» было бы неправдой о тех, кто молчит. */}
            {/* Сдавший целиком — один из отчитавшихся, а не все они:
                «целиком сдали: четверо» было неправдой о троих, которые
                сдавали только свою часть (задача №111). */}
            {waitable
              ? `Задачу сдали целиком, хотя ответили не все. Отчитались: ${progress.doneNames.map(shown).join(", ")}. Ещё не ответили: ${progress.pendingNames.map(shown).join(", ")}.`
              : progress.declined.length === 0
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
            {/* Сдали «за всех», а работа у каждого своя: задача снова ждёт
                молчащих, ничьи отчёты не снимаются, на приёмку вернётся сама. */}
            {waitable && onWaitForAll && (
              <button className="btn btn-small" type="button" id="waitForAllBtn" disabled={busy} onClick={() => void handleWait()}>
                Дождаться всех
              </button>
            )}
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
