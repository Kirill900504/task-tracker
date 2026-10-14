"use client";

import { useState } from "react";
import ActionMenu from "./ActionMenu";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import type { PersonOption } from "@/hooks/useTaskParticipants";
import { withoutSelfMark } from "@/lib/actorName";
import { isSelfAssignee } from "@/lib/trackerRows";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useColleagues } from "@/hooks/useColleagues";
import { awayMark, awayPhrase, isAwayOn } from "@/lib/away";
import { todayStr } from "@/lib/taskDisplay";

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
  // раздел. Поле одно на оба — меняются только подпись и то,
  // обязателен ли исполнитель. Второй такой список писать нельзя: в этом
  // проекте вторая копия расходилась с первой трижды, а здесь у первой
  // копии был ещё и обрез на двенадцати людях, который просто прятал
  // четырнадцатого.
  label?: string;
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

  // Кого сейчас нет (миграция 0047): пометка на кнопке и строка под полем,
  // если такого человека выбрали. Не запрет — поручить можно и уходящему в
  // отпуск, — а знание, без которого через три дня кажется, что он молчит.
  const { colleagues } = useColleagues();
  const today = todayStr();
  const awayOf = (id: string) => {
    const c = colleagues.find((p) => p.id === id);
    return c && isAwayOn(c.awayUntil, today) ? c : null;
  };
  const pickedAway = picked.map((p) => ({ p, away: awayOf(p.id) })).filter((x) => x.away);

  // Весь список сразу, без поиска и без «Ещё N» — и на телефоне, и на
  // компьютере.
  //
  // 14.10.2026 Кирилл сперва убрал поиск печатанием с телефона, а тем же
  // днём и отовсюду: «убери это поле ручного поиска в создании задач и
  // встреч, кнопками указывать будем кого надо». Пятнадцать имён в сетке
  // видны разом, и найти кнопку глазами быстрее, чем перевести руку на
  // клавиатуру; строка поиска над ними была ещё одним полем, которое
  // читается как обязательное.
  const isMobile = useIsMobile();


  return (
    <div className="field people-field">
      <label>
        {label}
        {requireExecutor && (
          <span className={"field-req" + (hasExecutor ? " met" : "")}>
            {hasExecutor ? "Исполнитель назначен" : "Нужен исполнитель"}
          </span>
        )}
      </label>
      <div className="participant-grid" id="fPeople">
        {people.map((person) => {
          const role = roleOf(person.id);
          return (
            <button
              key={person.id}
              type="button"
              data-person={person.id}
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
              {awayOf(person.id) && <span className="chip-away"> · {awayMark(awayOf(person.id)!.awayUntil)}</span>}
            </button>
          );
        })}
        {/* Завести нового человека с телефона нельзя (14.10.2026, его
            слова: «завести в трекер нового человека тоже убери возможность
            через мобильную версию»): новый человек появляется у всех
            пятнадцати, и это решение принимается за компьютером. */}
        {onAddPerson && !isMobile && (
          <button type="button" className="participant-chip chip-add" id="addAssigneeBtn" onClick={onAddPerson}>
            + человек
          </button>
        )}
      </div>

      {pickedAway.length > 0 && (
        <div className="field-hint away-hint">
          {pickedAway.map(({ p, away }) => `${shown(p.name)} ${awayPhrase(away!.awayKind, away!.awayUntil)}`).join("; ")} — поручить
          можно, но ответа до возвращения не ждите.
        </div>
      )}
      {/* Строки-пояснения «нажмите человека и выберите роль…» здесь
          больше нет — ни на телефоне, ни на компьютере (14.10.2026: «убери
          по всему трекеру… эти подсказки описания»). Роль спрашивает само
          меню, которое открывается нажатием, а снять человека — то же
          нажатие ещё раз, как у участников встречи. */}

      {menuFor && (
        <ActionMenu
          anchor={menuFor.anchor}
          title={shown(menuFor.person.name)}
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
