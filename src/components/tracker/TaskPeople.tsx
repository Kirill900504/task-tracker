"use client";

import { useState } from "react";
import type { Participant, PersonOption } from "@/hooks/useTaskParticipants";
import { hasDeclined, type TaskParticipantRole } from "@/lib/taskProgress";
import { personState } from "@/lib/personBadge";
import { withoutSelfMark } from "@/lib/actorName";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { useAsk } from "@/components/Ask";
import { answerWithFiles } from "@/lib/answerFiles";
import ActionMenu from "./ActionMenu";
import AddPeopleSheet from "./AddPeopleSheet";
import PersonBadge from "./PersonBadge";
import Icon from "./Icon";

// Люди на задаче — внутри сводки, по ролям, каждый со своим этапом.
//
// Слова Кирилла 13.10.2026: «этот блок с дурацким названием „кто на
// задаче“ дублирует блок со статусом, постановщиком и исполнителем… его
// предлагаю вообще убрать, а в верхнем блоке добавить небольшую кнопочку
// „+“»; «в верхнем блоке должны ставиться и меняться автоматически значки,
// кто из исполнителей взял в работу (зелёная галочка) и кто закончил (флаг
// финиша)… список исполнителей и других ролей тоже должен быть более
// выделен и без переносов из строки в строку»; «предусмотри функционал
// удаления с задачи человека или смены его роли».
//
// Поэтому: одна группа на роль, человек — фишкой целиком (имя не рвётся
// посередине, переносится фишка), нажатие по фишке — смена роли, вернуть
// ему одному на доработку, убрать. «+» — окно выбора поверх задачи
// (AddPeopleSheet). Прежний блок «Кто на задаче» (TeamCompact part=team)
// удалён целиком: две записи одного состава на одном экране — это и была
// жалоба.

const GROUPS: { role: TaskParticipantRole; one: string; many: string }[] = [
  { role: "executor", one: "Исполнитель", many: "Исполнители" },
  { role: "coexecutor", one: "Соисполнитель", many: "Соисполнители" },
  { role: "watcher", one: "Наблюдатель", many: "Наблюдатели" },
];

const ROLE_WORD: Record<TaskParticipantRole, string> = {
  executor: "исполнитель",
  coexecutor: "соисполнитель",
  watcher: "наблюдатель",
};

export default function TaskPeople({
  taskId,
  participants,
  availablePeople,
  canEdit,
  selfTask,
  closed,
  onAdd,
  onSetRole,
  onRemove,
  onReturnOne,
  onAddPerson,
  meId = "",
}: {
  taskId: string;
  participants: Participant[];
  availablePeople: PersonOption[];
  // Состав меняет только постановщик (миграция 0019; отказ базы молчалив,
  // поэтому кнопок у остальных нет вовсе).
  canEdit: boolean;
  // Своя задача: этапы не показываются — разговаривать в ней не с кем.
  selfTask: boolean;
  // Задача принята — вернуть кому-то одному уже нечего.
  closed: boolean;
  onAdd: (person: PersonOption, role: TaskParticipantRole) => void;
  onSetRole: (p: Participant, role: TaskParticipantRole) => void;
  onRemove: (p: Participant) => void;
  onReturnOne?: (participantId: string, comment: string) => void | Promise<void>;
  onAddPerson?: () => void;
  // Моя строка в списке людей. «Задача не дошла» про самого себя —
  // неправда: я её вижу прямо здесь, а мессенджер владельца привязан к
  // учётной записи, не к строке (lib/reach), и строка всегда «без чата».
  meId?: string;
}) {
  const ask = useAsk();
  const [menu, setMenu] = useState<{ p: Participant; anchor: DOMRect } | null>(null);
  const [adding, setAdding] = useState(false);

  const pickedIds = new Set(participants.map((p) => p.assigneeId));
  const unpicked = availablePeople.filter((p) => !pickedIds.has(p.id));
  const executorsCount = participants.filter((p) => p.role === "executor").length;

  // Последнего исполнителя не снять и не разжаловать: задача без
  // исполнителя никому не уходит и никем не закрывается («без исполнителя
  // запрети создавать» — и то же самое, полученное правкой, тоже запрет).
  // Раньше этот запрет стоял на кнопке «Сохранить»; кнопки больше нет —
  // изменения пишутся сразу, — значит запрет стоит на самом действии.
  async function refuseLastExecutor(p: Participant): Promise<boolean> {
    if (p.role !== "executor" || executorsCount > 1) return false;
    await ask.say({
      title: "Нужен исполнитель",
      question: `${withoutSelfMark(p.name)} — единственный исполнитель.`,
      note: "Сначала добавьте другого исполнителя (кнопка «+»), потом меняйте или убирайте этого.",
    });
    return true;
  }

  async function changeRole(p: Participant, role: TaskParticipantRole) {
    if (role !== "executor" && (await refuseLastExecutor(p))) return;
    onSetRole(p, role);
  }

  async function remove(p: Participant) {
    if (await refuseLastExecutor(p)) return;
    const yes = await ask.confirm({
      question: `Убрать ${withoutSelfMark(p.name)} с задачи?`,
      note: p.doneAt ? "Его отчёт уйдёт вместе с ним." : "Задача перестанет быть видна ему, если он больше нигде на ней не стоит.",
      okText: "Убрать",
      danger: true,
    });
    if (yes) onRemove(p);
  }

  async function returnOne(p: Participant) {
    if (!onReturnOne) return;
    const answer = await ask.askWithFiles({
      title: `Вернуть: ${withoutSelfMark(p.name)}`,
      question: "Что доделать?",
      note: "Увидит только этот человек. Остальные исполнители и их отчёты не затрагиваются. Приложенные документы лягут в обсуждение задачи.",
      multiline: true,
      okText: "Вернуть",
      required: "Возврат без объяснения бессмысленен — напишите, что не так.",
    });
    if (answer === null) return;
    await answerWithFiles({ kind: "task", id: taskId }, answer.files, `Документы к возврату на доработку: ${withoutSelfMark(p.name)}`, () =>
      onReturnOne(p.id, answer.text.trim()),
    );
  }

  return (
    <div className="tpeople" id="taskPeople">
      <div className="tpeople-head">
        <span className="fact-label">Люди на задаче</span>
        {canEdit && (unpicked.length > 0 || onAddPerson) && (
          <button type="button" className="tpeople-add" id="addTeamBtn" title="Добавить исполнителя, соисполнителя или наблюдателя" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
          </button>
        )}
      </div>

      {participants.length === 0 && <div className="tpeople-empty">Никого нет — добавьте исполнителя кнопкой «+».</div>}

      {GROUPS.map((g) => {
        const list = sortByPeopleOrder(
          participants.filter((p) => p.role === g.role),
          (p) => p.name,
        );
        if (!list.length) return null;
        return (
          <div className={"tpeople-group tpeople-" + g.role} key={g.role}>
            <div className="tpeople-label">{list.length > 1 ? g.many : g.one}</div>
            <div className="tpeople-list">
              {list.map((p) => {
                // Этап — у исполнителя и соисполнителя; наблюдатель не
                // отчитывается и не «приступает», и пустое кольцо «ещё не
                // приступал» у него читалось бы упрёком.
                const raw = selfTask || p.role === "watcher" ? undefined : personState(p);
                const state = raw === "unreachable" && meId && p.assigneeId === meId ? "waiting" : raw;
                const badge = <PersonBadge name={p.name} state={state} showName roleNote={ROLE_WORD[p.role]} stateWord />;
                return canEdit ? (
                  <button
                    type="button"
                    key={p.id}
                    className={"tperson role-" + p.role}
                    data-person={withoutSelfMark(p.name)}
                    title={`${withoutSelfMark(p.name)} — нажмите, чтобы сменить роль или убрать`}
                    onClick={(e) => setMenu({ p, anchor: e.currentTarget.getBoundingClientRect() })}
                  >
                    {badge}
                  </button>
                ) : (
                  <span key={p.id} className={"tperson role-" + p.role} data-person={withoutSelfMark(p.name)}>
                    {badge}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {menu && (
        <ActionMenu
          anchor={menu.anchor}
          title={withoutSelfMark(menu.p.name)}
          items={[
            ...GROUPS.filter((g) => g.role !== menu.p.role).map((g) => ({
              id: "role-" + g.role,
              label: `Сделать: ${g.one.toLowerCase()}`,
              onSelect: () => void changeRole(menu.p, g.role),
            })),
            // Отчитался или отказался — его ответ можно вернуть ему одному,
            // не дожидаясь остальных (отзыв Витовского 25.09.2026).
            ...(onReturnOne && !closed && menu.p.role === "executor" && (menu.p.doneAt || hasDeclined(menu.p))
              ? [{ id: "return-one", label: "Вернуть ему на доработку", onSelect: () => void returnOne(menu.p) }]
              : []),
            { id: "remove", label: "Убрать с задачи", onSelect: () => void remove(menu.p) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}

      {adding && <AddPeopleSheet people={unpicked} onAdd={onAdd} onAddPerson={onAddPerson} onClose={() => setAdding(false)} />}
    </div>
  );
}
