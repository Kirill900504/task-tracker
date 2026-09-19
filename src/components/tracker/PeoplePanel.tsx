"use client";

import { useMemo, useState } from "react";
import type { Task } from "@/types/tracker";
import { peopleLoad } from "@/lib/peoplePanel";
import Icon from "./Icon";

// «Загрузка» — к кому идти первым.
//
// Панель называлась «Люди» и показывала столбик цифр без подписей: «⚠ 2
// 🔕 1 ◍ 1 4». Кирилл сказал прямо 19.09.2026: «я вообще не понимаю
// смысловой нагрузки и зачем ты их сделал… объясни, как это должно
// помочь, если нету объяснений — удаляй».
//
// Объяснение у панели есть, и оно про то, ради чего вообще затевался
// многопользовательский трекер: когда исполнителей четырнадцать, вопрос
// «у кого горит» задаётся каждый день, а ответить на него можно было
// только фильтром по одному человеку за раз. Но объяснение не было
// написано НА САМОЙ панели, и цифры пришлось бы расшифровывать —
// значит панель не работала.
//
// Поэтому теперь:
//   — сверху сказано, что это за список и что делает нажатие;
//   — цифра стоит рядом со словом, а не под значком;
//   — строка показывается, только если по человеку есть о чём говорить,
//     а остальные прячутся под «ещё N» — четырнадцать спокойных строк
//     это стена, в которой не видно двух горящих.
//
// Нажатие — фильтр по этому человеку, повторное снимает. Это и есть
// ответ на «а что там у Игоря»: не отдельный экран, а тот же список
// задач, суженный до него.

export default function PeoplePanel({
  tasks,
  assignees,
  selected,
  onSelect,
}: {
  tasks: Task[];
  assignees: string[];
  // Имя выбранного человека или "all".
  selected: string;
  onSelect: (name: string) => void;
}) {
  const rows = useMemo(() => peopleLoad(tasks, assignees), [tasks, assignees]);
  const [showAll, setShowAll] = useState(false);

  // «Есть о чём говорить» — просрочено, молчит или ждёт приёмки. Просто
  // «четыре задачи в работе» новостью не является: так и должно быть.
  const hot = rows.filter((p) => p.overdue > 0 || p.silent > 0 || p.review > 0);
  const quiet = rows.filter((p) => !hot.includes(p));
  const shown = showAll ? [...hot, ...quiet] : hot;

  return (
    <div className="panel dash-panel" data-panel-id="peoplePanel">
      <div className="dash-panel-head">
        <h2 className="panel-title">
          Загрузка <span className="count">{rows.length}</span>
        </h2>
      </div>

      {!rows.length && <div className="empty">Никому ничего не поручено.</div>}

      {!!rows.length && !hot.length && !showAll && (
        <div className="empty">Ни у кого ничего не горит.</div>
      )}

      {shown.map((p) => (
        <button
          key={p.name}
          type="button"
          className={"people-row" + (selected === p.name ? " selected" : "")}
          title={selected === p.name ? "Показать снова все задачи" : `Показать только задачи: ${p.name}`}
          onClick={() => onSelect(selected === p.name ? "all" : p.name)}
        >
          <span className="people-name">{p.name}</span>
          <span className="people-nums">
            {/* Цифра со словом, а не под значком: «⚠ 2» читается только
                тем, кто уже знает, что значит ⚠. Ноль не рисуется вовсе —
                строка из четырёх нулей выглядит как таблица, в которой
                нечего искать. */}
            {p.overdue > 0 && (
              <span className="people-num bad">
                <Icon name="warning" size={12} /> {p.overdue} просрочено
              </span>
            )}
            {p.silent > 0 && <span className="people-num warn">{p.silent} без ответа</span>}
            {p.review > 0 && <span className="people-num ok">{p.review} на приёмке</span>}
            {p.open > 0 && <span className="people-num">{p.open} в работе</span>}
          </span>
        </button>
      ))}

      {!!quiet.length && (
        <button type="button" className="people-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Скрыть спокойных" : `Ещё ${quiet.length} — у кого всё идёт`}
        </button>
      )}
    </div>
  );
}
