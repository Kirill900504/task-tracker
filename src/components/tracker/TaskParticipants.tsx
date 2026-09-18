"use client";

import { useState } from "react";
import type { ApprovalState } from "@/types/tracker";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import { hasDeclined, progressLabel, taskProgress, taskStage } from "@/lib/taskProgress";
import type { Participant, PersonOption } from "@/hooks/useTaskParticipants";
import { useAsk } from "@/components/Ask";

// «Кто на задаче» — и в каком состоянии каждый из них.
//
// The single `assignee` field could answer "who is this for". It cannot
// answer the question this block exists for: four people, two of whom must
// each report separately, one who is helping and one who is only watching.
// So participation is a list, roles are explicit, and every executor's own
// state — принял / сделал с комментарием / не может с причиной — is shown
// next to his name rather than summed into one badge.
//
// Only executors hold the task open (see taskProgress.ts). That rule is
// worth seeing rather than reading about, which is why the roles are named
// in the interface and not just in the data.

const ROLE_LABEL: Record<TaskParticipantRole, string> = {
  executor: "исполнитель",
  coexecutor: "соисполнитель",
  watcher: "наблюдатель",
};

const STAGE_LABEL: Record<string, string> = {
  sent: "отправлено, ещё не приняли",
  accepted: "в работе",
  blocked: "кто-то не может",
  awaiting_review: "на приёмке",
  returned: "на доработке",
  done: "принято",
};

export default function TaskParticipants({
  taskId,
  participants,
  available,
  approvalState,
  approvalComment,
  onAdd,
  onSetRole,
  onRemove,
  onApprove,
  onReturn,
  onForceClose,
  onAcceptReschedule,
  onRejectReschedule,
}: {
  taskId: string;
  participants: Participant[];
  available: PersonOption[];
  approvalState: ApprovalState;
  approvalComment?: string;
  onAdd: (assigneeId: string, role: TaskParticipantRole) => void | Promise<string | void>;
  onSetRole: (participantId: string, role: TaskParticipantRole) => void;
  onRemove: (participantId: string) => void;
  onApprove: (comment: string) => void;
  onReturn: (comment: string) => void;
  onForceClose: (reason: string) => void;
  onAcceptReschedule: (participantId: string, date: string) => void;
  onRejectReschedule: (participantId: string) => void;
}) {
  const ask = useAsk();
  const [addWho, setAddWho] = useState("");
  const [addRole, setAddRole] = useState<TaskParticipantRole>("executor");
  // «Добавил, а ему не ушло» — то, о чём постановщик обязан узнать сразу.
  const [notice, setNotice] = useState("");

  const progress = taskProgress(participants);
  const stage = taskStage(participants, approvalState);
  const label = progressLabel(participants);

  async function handleAdd() {
    if (!addWho) return;
    setNotice("");
    const result = await onAdd(addWho, addRole);
    setAddWho("");
    if (typeof result === "string" && result) setNotice(result);
  }

  async function handleApprove() {
    // Приёмка без слов — обычное дело («принял, спасибо»), поэтому пусто
    // здесь допустимо, в отличие от отчёта исполнителя.
    const comment = await ask.ask({
      title: "Приёмка работы",
      question: "Комментарий к приёмке",
      note: "Можно оставить пустым — его увидят исполнители.",
      multiline: true,
      okText: "Принять",
    });
    if (comment === null) return;
    onApprove(comment.trim());
  }

  async function handleReturn() {
    const comment = await ask.ask({
      title: "Вернуть на доработку",
      question: "Что доделать?",
      note: "Это увидят исполнители — и это единственное, что объясняет возврат.",
      multiline: true,
      okText: "Вернуть",
      required: "Возврат без объяснения бессмысленен — напишите, что не так.",
    });
    if (comment === null) return;
    onReturn(comment.trim());
  }

  async function handleForceClose() {
    const reason = await ask.ask({
      title: "Закрыть волевым решением",
      question: "Почему закрываем?",
      note: "Причина останется в задаче: именно она объясняет, почему задача закрыта не как обычно.",
      multiline: true,
      okText: "Закрыть задачу",
      required: "Причина обязательна: именно она объясняет, почему задача закрыта не как обычно.",
    });
    if (reason === null) return;
    onForceClose(reason.trim());
  }

  return (
    <div className="tp" data-task={taskId}>
      <div className="tp-head">
        <span className="tp-title">Кто на задаче</span>
        <span className={"tp-stage tp-stage-" + stage}>{STAGE_LABEL[stage] || stage}</span>
      </div>

      {label && <div className="tp-progress">{label}</div>}

      {approvalState === "returned" && approvalComment && (
        <div className="tp-returned">Возвращено на доработку: {approvalComment}</div>
      )}

      {participants.length === 0 && (
        <div className="tp-empty">
          Никого нет. Добавьте исполнителя — тогда задача начнёт спрашивать с человека, а не лежать.
        </div>
      )}

      {/* Просьбы о переносе — над списком: это единственное, что требует
          решения прямо сейчас, и увидеть её в общем ряду мелким шрифтом
          значит не увидеть вовсе. */}
      {participants
        .filter((p) => p.rescheduleTo || p.rescheduleReason)
        .map((p) => (
          <div className="tp-ask" key={"ask-" + p.id}>
            <div className="tp-ask-text">
              <b>{p.name}</b> просит перенести
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

      {participants.map((p) => (
        <div className="tp-row" key={p.id}>
          <span className="tp-name">{p.name || "—"}</span>

          <select
            className="tp-role"
            value={p.role}
            onChange={(e) => onSetRole(p.id, e.target.value as TaskParticipantRole)}
            title="Роль в задаче"
          >
            {(Object.keys(ROLE_LABEL) as TaskParticipantRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>

          <span className="tp-state">
            {p.doneAt && <span className="tp-done" title={p.doneComment || ""}>🏁 сделал{p.doneComment ? ": " + p.doneComment : ""}</span>}
            {!p.doneAt && hasDeclined(p) && (
              <span className="tp-declined">⛔ не может{p.declineReason ? ": " + p.declineReason : ""}</span>
            )}
            {!p.doneAt && !hasDeclined(p) && p.acceptedAt && <span className="tp-accepted">✅ принял</span>}
            {/* «Ждём ответа» от человека без мессенджера — неправда: задача
                до него не доехала, и ждать нечего. Поэтому одно вместо
                другого, а не рядом. Видно это должно быть всегда, а не
                только в секунду добавления: в боевом трекере четверо из
                шести не подключены. */}
            {!p.doneAt && !hasDeclined(p) && !p.acceptedAt && p.role === "executor" && p.reachable !== false && (
              <span className="tp-waiting">ждём ответа</span>
            )}
            {!p.doneAt && !hasDeclined(p) && p.reachable === false && (
              <span className="tp-unreachable" title="Задача ему не отправлена: нет ни Telegram, ни MAX. Подключить можно в «Команде».">
                📭 не подключён — задача не ушла
              </span>
            )}
          </span>

          <button className="btn btn-small tp-remove" type="button" title="Убрать с задачи" onClick={() => onRemove(p.id)}>
            ✕
          </button>
        </div>
      ))}

      {available.length > 0 && (
        <div className="tp-add">
          <select value={addWho} onChange={(e) => setAddWho(e.target.value)}>
            <option value="">— добавить человека —</option>
            {available.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as TaskParticipantRole)}>
            {(Object.keys(ROLE_LABEL) as TaskParticipantRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button className="btn btn-small" type="button" onClick={() => void handleAdd()} disabled={!addWho}>
            Добавить
          </button>
        </div>
      )}

      {notice && <div className="tp-notice">{notice}</div>}

      {/* B4: отчитались все — дальше слово за постановщиком. Это и есть
          «Кирилл проверит», ради чего всё затевалось. */}
      {stage === "awaiting_review" && (
        <div className="tp-review">
          <div className="tp-review-text">Все исполнители отчитались. Принимаете работу?</div>
          <div className="tp-review-actions">
            <button className="btn btn-small btn-primary" type="button" onClick={() => void handleApprove()}>
              Принять
            </button>
            <button className="btn btn-small" type="button" onClick={() => void handleReturn()}>
              Вернуть на доработку
            </button>
          </div>
        </div>
      )}

      {/* B2: одна ничья задача иначе висит вечно. */}
      {progress.total > 0 && stage !== "done" && stage !== "awaiting_review" && (
        <button className="btn btn-small tp-force" type="button" onClick={() => void handleForceClose()}>
          Закрыть волевым решением
        </button>
      )}
    </div>
  );
}
