"use client";

import { useState } from "react";
import ActionMenu from "./ActionMenu";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import type { PersonOption } from "@/hooks/useTaskParticipants";
import { withoutSelfMark } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import { useIsMobile } from "@/hooks/useIsMobile";

// Кто на задаче — одним полем.
//
// Раньше их было два, и они спрашивали почти одно и то же: «Исполнитель»
// выпадающим списком (плюс «+» и «−» рядом) и «Кто на задаче» — выбрать
// человека, выбрать роль, нажать «Добавить». Три действия на каждого, два
// разных места для одного вопроса и постоянная путаница, чем первое
// отличается от второго. Кирилл попросил одно поле, и он прав: вопрос
// действительно один — кто это делает.
//
// Люди стоят кнопками, как участники встречи: вся команда видна сразу и
// выбирается одним касанием. Роль спрашивается следом, маленьким меню у
// самой кнопки — тем же, каким календарь спрашивает «задача или встреча»
// при щелчке по дате. На телефоне это меню само становится полосой у
// нижнего края (см. ActionMenu), так что выбор роли не превращается в
// попадание пальцем в строку выпадающего списка.
//
// Нажатие устроено как у участников встречи, где кнопка просто включает и
// выключает человека: первое спрашивает роль, второе снимает с задачи.
//
// Удалить человека из списка людей отсюда нельзя вовсе, и это решение, а не
// упущение. Такая кнопка здесь была ровно один день и за этот день стоила
// Кириллу Котова Михаила: строка в assignees удаляется каскадом, унося с
// собой всё участие во всех задачах и встречах. Восстановить удалось только
// то, что записано где-то ещё — имя в самой задаче и в составе встречи;
// «принял», «сделал» и голоса не вернулись ниоткуда. Кнопка, стоящая рядом с
// «убрать с задачи» и выглядящая так же, но означающая на два порядка
// больше, — плохая кнопка, и её здесь нет.

export type PickedPerson = { id: string; name: string; role: TaskParticipantRole };

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

export default function PeoplePicker({
  people,
  picked,
  onPick,
  onRemove,
  onAddPerson,
  label = "Кто на задаче",
  hint,
  requireExecutor = true,
}: {
  people: PersonOption[];
  picked: PickedPerson[];
  onPick: (person: PersonOption, role: TaskParticipantRole) => void;
  onRemove: (person: PickedPerson) => void;
  // «Человека нет в списке» — тот же вопрос, что раньше задавала кнопка «+»
  // рядом с выпадающим списком.
  onAddPerson?: () => void;
  // Тот же вопрос задают в двух местах: кто на задаче и кто отвечает за
  // раздел. Поле одно на оба — меняются только подпись, пояснение и то,
  // обязателен ли исполнитель. Второй такой список писать нельзя: в этом
  // проекте вторая копия расходилась с первой трижды, а здесь у первой
  // копии был ещё и обрез на двенадцати людях, который просто прятал
  // четырнадцатого.
  label?: string;
  hint?: string;
  requireExecutor?: boolean;
}) {
  const [menuFor, setMenuFor] = useState<{ person: PersonOption; anchor: DOMRect } | null>(null);
  const roleOf = (id: string) => picked.find((p) => p.id === id)?.role;

  // Исполнитель обязателен (см. save() в TaskModal). Сказать об этом надо
  // здесь, у самого поля, а не только окном при сохранении: правило,
  // которое человек узнаёт в момент отказа, выглядит придиркой, а то же
  // правило, стоящее у поля, — обычным требованием формы.
  const hasExecutor = picked.some((p) => p.role === "executor");

  // Пометка «(я)» — часть строки в базе (по ней трекер узнаёт владельца),
  // а не часть имени, и на экране её не показывают даже ему самому: Кирилл
  // 24.09.2026 назвал «Кирилл Кучеренко (я)» в списке людей дурацким —
  // свою строку он и так узнаёт по месту и по контексту, а метка читается
  // как опечатка. В задачу при этом всегда уходит ПОЛНОЕ имя строки: там
  // оно должно совпадать с базой буква в букву.
  const shown = (name: string) => withoutSelfMark(name);

  // На телефоне список свёрнут, пока его не раскроют.
  //
  // Осмотр 21.09.2026: четырнадцать имён — это семь рядов кнопок, то есть
  // ПОЛ-ЭКРАНА телефона в форме новой задачи, и срок с разделом лежат под
  // ними. Поставить задачу с телефона значило пролистать всю команду.
  // Поэтому видны первые шестеро, все уже выбранные и своя строка — а
  // остальные за кнопкой «Ещё N», одно нажатие.
  // Свою видно всегда нарочно: задачу себе ставят чаще, чем кому бы то ни
  // было, а по фамилии она может оказаться и последней (порядок людей
  // общий на весь трекер, см. lib/peopleOrder, и менять его здесь нельзя).
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_COUNT = 6;
  const collapsed = isMobile && !expanded && people.length > COLLAPSED_COUNT + 2;
  const visiblePeople = collapsed
    ? people.filter((p, i) => i < COLLAPSED_COUNT || !!roleOf(p.id) || p.name.trim().endsWith("(я)"))
    : people;
  const hiddenCount = people.length - visiblePeople.length;

  return (
    <div className="field people-field">
      <label>
        {label}
        {requireExecutor && (
          <span className={"field-req" + (hasExecutor ? " met" : "")}>
            {hasExecutor ? "исполнитель назначен" : "нужен исполнитель"}
          </span>
        )}
      </label>
      <div className="participant-grid" id="fPeople">
        {visiblePeople.map((person) => {
          const role = roleOf(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={"participant-chip" + (role ? " selected role-" + role : "")}
              // Метка «(я)» с экрана убрана (см. комментарий у shown() выше),
              // но e2e по-прежнему нужен надёжный способ найти именно свою
              // строку — data-self держит это без единого слова на экране.
              data-self={isSelfAssignee(person.name) ? "true" : undefined}
              onClick={(e) => {
                // Нажал — спросили роль. Нажал второй раз — снял с задачи.
                // Так это работает у участников встречи (там нажатие просто
                // включает и выключает человека), и разными эти два списка
                // быть не должны: роль — единственное, чем они отличаются,
                // и спросить о ней стоит там же, где выбирают человека.
                if (role) onRemove({ id: person.id, name: person.name, role });
                else setMenuFor({ person, anchor: e.currentTarget.getBoundingClientRect() });
              }}
              title={
                role ? `${shown(person.name)} — ${ROLE_LABEL[role]}. Нажмите, чтобы снять` : `Выбрать: ${shown(person.name)}`
              }
            >
              {shown(person.name)}
              {role && role !== "executor" && <span className="chip-role"> · {ROLE_LABEL[role]}</span>}
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <button type="button" className="participant-chip chip-more" id="morePeopleBtn" onClick={() => setExpanded(true)}>
            Ещё {hiddenCount}
          </button>
        )}
        {onAddPerson && (
          <button type="button" className="participant-chip chip-add" id="addAssigneeBtn" onClick={onAddPerson}>
            + человек
          </button>
        )}
      </div>

      {/* На телефоне пояснение короткое: полный текст — четыре строки,
          и в форме, где до срока и так надо долистать, они читаются один
          раз в жизни, а место занимают всегда. Смысл при этом не теряется:
          что делает второе нажатие, сказано и здесь. */}
      <div className="tp-hint">
        {hint ||
          (isMobile
            ? "Нажмите человека и выберите роль; второе нажатие снимает его с задачи."
            : "Нажмите на человека и выберите роль; нажали второй раз — он снят с задачи. Исполнителей может быть несколько — задача закроется, когда отчитается каждый. Соисполнитель помогает, наблюдатель только видит.")}
      </div>

      {menuFor && (
        <ActionMenu
          anchor={menuFor.anchor}
          title={menuFor.person.name}
          // Только роли. «Убрать с задачи» отсюда ушло — это второе нажатие
          // по самой кнопке; а удаления человека из списка людей нет вовсе
          // (см. комментарий наверху файла).
          items={ROLE_MENU.map((r) => ({
            id: r.role,
            label: r.label,
            onSelect: () => onPick(menuFor.person, r.role),
          }))}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}
