"use client";

import { useState } from "react";
import type { ApprovalState } from "@/types/tracker";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import { hasDeclined, progressLabel, taskProgress, taskStage } from "@/lib/taskProgress";
import type { Participant, PersonOption } from "@/hooks/useTaskParticipants";
import { useAsk } from "@/components/Ask";
import { withoutSelfMark } from "@/lib/actorName";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import ActionMenu from "./ActionMenu";
import Icon, { type IconName } from "./Icon";

// «Кто на задаче» и приёмка — одним компактным блоком.
//
// Раньше это были три отдельных куска карточки: полный ряд кнопок-людей
// (PeoplePicker), под ним ещё раз тот же список строками с ролью и
// статусом (TaskParticipants), и в самом низу, у обсуждения, — приёмка.
// Слова Кирилла 22.09.2026: «в уже созданной задаче оба блока «кто на
// задаче» — не нужны, но какая-то возможность добавить исполнителей,
// соисполнителей и наблюдателей должна присутствовать, но не занимать
// много места… функцию на стадии приёмки тоже перенести вверх».
//
// Имя человека теперь несёт и роль, и статус — одной кнопкой-фишкой, как
// везде в трекере, а не отдельной строкой на каждого. Добавление — тем же
// нажатием «+», только список сразу короче: не вся команда, а только те,
// кого на задаче ещё нет.
const ROLE_LABEL: Record<TaskParticipantRole, string> = {
  executor: "исполнитель",
  coexecutor: "соисполнитель",
  watcher: "наблюдатель",
};

const ROLE_MENU: { role: TaskParticipantRole; label: string }[] = [
  { role: "executor", label: "Исполнитель — отчитывается сам" },
  { role: "coexecutor", label: "Соисполнитель — помогает" },
  { role: "watcher", label: "Наблюдатель — только видит" },
];

type Status = { cls: string; icon: IconName | null; text: string };

function statusOf(p: Participant): Status | null {
  if (p.doneAt) return { cls: "status-done", icon: "flag", text: "сделал" + (p.doneComment ? ": " + p.doneComment : "") };
  if (hasDeclined(p)) return { cls: "status-declined", icon: "ban", text: "не может" + (p.declineReason ? ": " + p.declineReason : "") };
  if (p.acceptedAt) return { cls: "status-accepted", icon: "check", text: "принял" };
  // «Ждём ответа» от человека без мессенджера — неправда: задача до него
  // не доехала. См. то же правило в бывшем TaskParticipants.tsx.
  if (p.reachable === false) return { cls: "status-unreachable", icon: "mailbox", text: "не подключён — задача не ушла" };
  if (p.role === "executor") return { cls: "status-waiting", icon: null, text: "ждём ответа" };
  return null;
}

export default function TeamCompact({
  participants,
  availablePeople,
  approvalState,
  approvalComment,
  onAddParticipant,
  onSetParticipantRole,
  onRemoveParticipant,
  onApproveWork,
  onReturnWork,
  onForceCloseWork,
  onReopenWork,
  onAcceptReschedule,
  onRejectReschedule,
  onAddPerson,
  part,
}: {
  participants: Participant[];
  availablePeople: PersonOption[];
  approvalState: ApprovalState;
  approvalComment?: string;
  onAddParticipant: (assigneeId: string, role: TaskParticipantRole) => void | Promise<string | void>;
  onSetParticipantRole: (participantId: string, role: TaskParticipantRole) => void;
  onRemoveParticipant: (participantId: string) => void;
  onApproveWork: (comment: string) => void | Promise<void>;
  onReturnWork: (comment: string) => void | Promise<void>;
  onForceCloseWork: (reason: string) => void | Promise<void>;
  onReopenWork: (comment: string) => void | Promise<void>;
  onAcceptReschedule: (participantId: string, date: string) => void;
  onRejectReschedule: (participantId: string) => void;
  // Завести нового человека — только у администратора (см. PeoplePicker).
  onAddPerson?: () => void;
  // Какую половину рисовать. «decisions» — то, что ждёт решения
  // постановщика (просьбы о переносе, приёмка, открыть заново); «team» —
  // состав и всё остальное. Без значения — обе, одним блоком, как было.
  //
  // Разделено 24.09.2026, словами Кирилла: «блоки, призывающие к действию
  // для постановщика… должны идти сразу за описанием задачи… Не правильно,
  // когда за тем, чтобы отреагировать на исполнение поставленной тобой
  // задачи другому человеку, приходится опускаться в середину окна или тем
  // более в самый низ». Решение стояло под фактами, результатом и списком
  // людей. Половины — один компонент с одними обработчиками, а не второй
  // блок приёмки рядом: копия таких правил в этом проекте расходилась с
  // первой трижды.
  part?: "decisions" | "team";
}) {
  const ask = useAsk();
  const identity = useWorkspaceRole();
  const shown = (name: string) => (identity.isOwner ? name : withoutSelfMark(name));

  const progress = taskProgress(participants);
  const stage = taskStage(participants, approvalState);
  const label = progressLabel(participants);

  const [personMenu, setPersonMenu] = useState<{ p: Participant; anchor: DOMRect } | null>(null);
  const [addMenu, setAddMenu] = useState<DOMRect | null>(null);
  const [roleFor, setRoleFor] = useState<{ person: PersonOption; anchor: DOMRect } | null>(null);
  // Приёмка, возврат, волевое закрытие и открытие заново все двигают
  // задачу и после успеха закрывают карточку (см. onApproveWork и
  // соседей в TasksPanel.tsx) — но карточка закрывается только когда
  // ответ сети ВЕРНУЛСЯ, а «Принять» ничем не блокировалось до этого
  // момента. При задержке сети повторное нажатие успевало открыть окно
  // комментария второй раз и отправить приёмку ещё раз с другим текстом —
  // «два раза закрыть с разными комментариями» (Кирилл, 24.09.2026, по
  // скриншоту). busy — тот же приём, что уже стоит в TaskAnswer.tsx у
  // ответа исполнителя.
  const [busy, setBusy] = useState(false);

  const pickedIds = new Set(participants.map((p) => p.assigneeId));
  const unpicked = availablePeople.filter((p) => !pickedIds.has(p.id));
  const canAddMore = unpicked.length > 0 || !!onAddPerson;

  async function handleApprove() {
    if (busy) return;
    const comment = await ask.ask({
      title: "Приёмка работы",
      question: "Комментарий к приёмке",
      note: "Его увидят исполнители — подтвердите, что именно принимаете.",
      multiline: true,
      okText: "Принять",
      // Обязателен — как и у возврата, и у волевого закрытия. До
      // 23.09.2026 можно было принять чужую работу пустым нажатием: слова
      // Кирилла об этом прямом случае — «закрыл успешно без заполнения
      // финального комментария. Это по-хорошему ошибка». Решение без единого
      // слова неотличимо от того, что его никто не читал.
      required: "Приёмка без комментария не решение — напишите хотя бы, что именно принимаете.",
    });
    if (comment === null || busy) return;
    setBusy(true);
    try {
      await onApproveWork(comment.trim());
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn() {
    if (busy) return;
    const comment = await ask.ask({
      title: "Вернуть на доработку",
      question: "Что доделать?",
      note: "Это увидят исполнители — и это единственное, что объясняет возврат.",
      multiline: true,
      okText: "Вернуть",
      required: "Возврат без объяснения бессмысленен — напишите, что не так.",
    });
    if (comment === null || busy) return;
    setBusy(true);
    try {
      await onReturnWork(comment.trim());
    } finally {
      setBusy(false);
    }
  }

  async function handleForceClose() {
    if (busy) return;
    const reason = await ask.ask({
      title: "Закрыть волевым решением",
      question: "Почему закрываем?",
      note: "Причина останется в задаче: именно она объясняет, почему задача закрыта не как обычно.",
      multiline: true,
      okText: "Закрыть задачу",
      required: "Причина обязательна: именно она объясняет, почему задача закрыта не как обычно.",
    });
    if (reason === null || busy) return;
    setBusy(true);
    try {
      await onForceCloseWork(reason.trim());
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (busy) return;
    const comment = await ask.ask({
      title: "Открыть задачу заново",
      question: "Что изменилось?",
      note: "Можно оставить пустым. Отчёты исполнителей никуда не денутся — задача вернётся туда, где была до приёмки, и по ней можно отчитаться заново.",
      multiline: true,
      okText: "Открыть заново",
    });
    if (comment === null || busy) return;
    setBusy(true);
    try {
      await onReopenWork(comment.trim());
    } finally {
      setBusy(false);
    }
  }

  const asksOpen = participants.some((p) => p.rescheduleTo || p.rescheduleReason);
  const decisionsBlock = (
    <>
      {/* Просьбы о переносе — первыми: решение, которого ждут прямо сейчас. */}
      {participants
        .filter((p) => p.rescheduleTo || p.rescheduleReason)
        .map((p) => (
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

      {/* Приёмка — то, ради чего постановщик открывает задачу на этой
          стадии; где она стоит в окне, решает part (см. выше). */}
      {stage === "awaiting_review" && (
        <div className="tp-review">
          <div className="tp-review-text">
            {progress.declined.length === 0
              ? "Все исполнители отчитались. Принимаете работу?"
              : progress.doneCount === 0
                ? `Работу не сделают: ${progress.declined.map((d) => d.name).join(", ")}. Решать вам.`
                : `Отчитались не все: ${progress.declined.map((d) => d.name).join(", ")} не смогут. Решать вам.`}
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
            {progress.declined.length > 0 && (
              <button className="btn btn-small" type="button" disabled={busy} onClick={() => void handleForceClose()}>
                Закрыть волевым решением
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

    </>
  );

  if (part === "decisions") {
    if (!asksOpen && stage !== "awaiting_review" && stage !== "done") return null;
    return <div className="field team-decisions" id="taskDecisions">{decisionsBlock}</div>;
  }

  return (
    <div className="field team-compact">
      <label>Кто на задаче</label>

      {label && <div className="tp-progress">{label}</div>}

      {approvalState === "returned" && approvalComment && (
        <div className="tp-returned">Возвращено на доработку: {approvalComment}</div>
      )}

      {part !== "team" && decisionsBlock}

      {participants.length === 0 && (
        <div className="tp-empty">
          Никого нет. Добавьте исполнителя — тогда задача начнёт спрашивать с человека, а не лежать.
        </div>
      )}

      <div className="participant-grid">
        {participants.map((p) => {
          const status = statusOf(p);
          return (
            <button
              key={p.id}
              type="button"
              className={"participant-chip selected role-" + p.role}
              title={`${shown(p.name)} — ${ROLE_LABEL[p.role]}${status ? " · " + status.text : ""}. Нажмите, чтобы изменить роль или убрать`}
              onClick={(e) => setPersonMenu({ p, anchor: e.currentTarget.getBoundingClientRect() })}
            >
              {shown(p.name)}
              {p.role !== "executor" && <span className="chip-role"> · {ROLE_LABEL[p.role]}</span>}
              {status && (
                <span className={"chip-status " + status.cls}>
                  {status.icon ? <Icon name={status.icon} size={12} /> : "···"}
                </span>
              )}
            </button>
          );
        })}
        {canAddMore && (
          <button
            type="button"
            className="participant-chip chip-add"
            id="addTeamBtn"
            title="Добавить исполнителя, соисполнителя или наблюдателя"
            onClick={(e) => setAddMenu(e.currentTarget.getBoundingClientRect())}
          >
            + добавить
          </button>
        )}
      </div>

      {personMenu && (
        <ActionMenu
          anchor={personMenu.anchor}
          title={shown(personMenu.p.name)}
          items={[
            ...ROLE_MENU.filter((r) => r.role !== personMenu.p.role).map((r) => ({
              id: r.role,
              label: r.label,
              onSelect: () => onSetParticipantRole(personMenu.p.id, r.role),
            })),
            { id: "remove", label: "Убрать с задачи", onSelect: () => onRemoveParticipant(personMenu.p.id) },
          ]}
          onClose={() => setPersonMenu(null)}
        />
      )}

      {addMenu && (
        <ActionMenu
          anchor={addMenu}
          title="Кого добавить"
          items={[
            ...unpicked.map((person) => ({
              id: person.id,
              label: shown(person.name),
              onSelect: () => setRoleFor({ person, anchor: addMenu }),
            })),
            ...(onAddPerson ? [{ id: "new-person", label: "+ новый человек", onSelect: onAddPerson }] : []),
          ]}
          onClose={() => setAddMenu(null)}
        />
      )}

      {roleFor && (
        <ActionMenu
          anchor={roleFor.anchor}
          title={shown(roleFor.person.name)}
          items={ROLE_MENU.map((r) => ({
            id: r.role,
            label: r.label,
            onSelect: () => void onAddParticipant(roleFor.person.id, r.role),
          }))}
          onClose={() => setRoleFor(null)}
        />
      )}

      {/* Раньше требовало хотя бы одного участника — а строку про 23.09.2026
          в taskStage() потому и написали, что задача может остаться и БЕЗ
          них (сбой синхронизации), и именно тогда эта кнопка — единственный
          выход. Волевое закрытие не должно зависеть от того, сошлась ли
          локальная копия участников с тем, что знает сервер. */}
      {stage !== "done" && stage !== "awaiting_review" && (
        <button className="btn btn-small tp-force" type="button" disabled={busy} onClick={() => void handleForceClose()}>
          Закрыть волевым решением
        </button>
      )}
    </div>
  );
}
