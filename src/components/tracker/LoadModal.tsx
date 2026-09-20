"use client";

import { useMemo, useState } from "react";
import type { Task } from "@/types/tracker";
import { peopleLoad } from "@/lib/peoplePanel";
import Modal from "./Modal";
import Icon from "./Icon";

// «Загрузка» — к кому идти первым. Теперь окном, а не панелью.
//
// Панель стояла в правой колонке над мыслями, и 20.09.2026 Кирилл сказал
// о ней две вещи сразу: «фильтр по исполнителю получается не нужен, если
// добавил блок загрузка» и «а оттуда этот блок убери, он мешает».
//
// Оба замечания об одном. Список «у кого что горит» смотрят не постоянно,
// а когда задаются вопросом «к кому идти» — то есть это не то, что должно
// занимать высоту экрана каждый день. А фильтр по исполнителю, стоявший в
// полосе кнопок, спрашивал ровно то же самое, только хуже: выпадающим
// списком из четырнадцати имён и без единой цифры рядом с ними. Двух
// ответов на один вопрос в трекере уже было достаточно.
//
// Поэтому теперь один: кнопка «Загрузка» в полосе над доской открывает
// это окно, выбор человека сужает доску до него, и окно закрывается —
// смотреть на список людей поверх задач, которые он же и отфильтровал,
// незачем.
//
// Строка показывается, только если по человеку есть о чём говорить, а
// остальные прячутся под «ещё N»: четырнадцать спокойных строк это стена,
// в которой не видно двух горящих.

export default function LoadModal({
  tasks,
  assignees,
  selected,
  onSelect,
  onClose,
}: {
  tasks: Task[];
  assignees: string[];
  // Имя выбранного человека или "all".
  selected: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => peopleLoad(tasks, assignees), [tasks, assignees]);
  const [showAll, setShowAll] = useState(false);

  // «Есть о чём говорить» — просрочено, молчит или ждёт приёмки. Просто
  // «четыре задачи в работе» новостью не является: так и должно быть.
  const hot = rows.filter((p) => p.overdue > 0 || p.silent > 0 || p.review > 0);
  const quiet = rows.filter((p) => !hot.includes(p));
  const shown = showAll ? [...hot, ...quiet] : hot;

  // Выбор человека — это и есть фильтр доски, и после него в окне делать
  // нечего: оно закрыло бы собой тот самый список, ради которого выбирали.
  function pick(name: string) {
    onSelect(selected === name ? "all" : name);
    onClose();
  }

  return (
    <Modal onClose={onClose} id="loadModal">
      {/* `.modal` обязателен, хотя со стороны выглядит лишней обёрткой:
          сам <dialog class="overlay"> — это только затемнённый фон с
          display:flex, а коробка окна (фон, рамка, отступы, ширина) живёт
          на этом div. Без него содержимое раскладывается прямо по
          затемнению в строку — заголовок в одном углу, кнопка в другом. */}
      <div className="modal load-modal">
        <h2>
          Загрузка <span className="count">{rows.length}</span>
        </h2>
        <p className="field-hint">Кто чем занят и у кого горит. Нажмите на человека — доска покажет только его задачи.</p>

        {!rows.length && <div className="empty">Никому ничего не поручено.</div>}

        {!!rows.length && !hot.length && !showAll && <div className="empty">Ни у кого ничего не горит.</div>}

        {selected !== "all" && (
          <button
            type="button"
            className="people-more"
            onClick={() => {
              onSelect("all");
              onClose();
            }}
          >
            Показать задачи всех
          </button>
        )}

        {shown.map((p) => (
          <button
            key={p.name}
            type="button"
            className={"people-row" + (selected === p.name ? " selected" : "")}
            title={selected === p.name ? "Показать снова все задачи" : `Показать только задачи: ${p.name}`}
            onClick={() => pick(p.name)}
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

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}
