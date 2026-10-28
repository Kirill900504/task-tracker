"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { grow, shrink } from "@/lib/smoothHeight";
import AutoGrowTextarea from "./AutoGrowTextarea";
import Icon from "./Icon";

// Шапка окна: название, действия и × в правом верхнем углу.
//
// Родилась шапкой открытой задачи и встречи. Слова Кирилла 13.10.2026:
// «название задачи тоже визуально оформи, чтобы чётко выделялось и
// бросалось в глаза… возможно тоже с каким-то контуром»; «любые изменения,
// вносимые в уже созданную задачу, должны автоматически в ней сохраняться,
// то есть кнопки „Удалить, Сохранить, Отмена“ не нужны… но в правом
// верхнем углу должен быть крестик для закрытия окна (помимо Esc)»;
// «кнопку „закрыть волевым решением“ перенеси в правый верхний угол
// (слева от значка закрытия окна)».
//
// С 14.10.2026 — шапка ВСЕХ окон: «во всех окнах проверь и замени кнопки
// закрыть или отмена по единому формату крестик в правом верхнем углу».
// До этого у «Команды», «Разделов», «Загрузки», списков завершённого и
// кабинета внизу стояла кнопка «Закрыть», у задачи — ×, у добавления людей
// — × своей разметкой: три способа сказать одно и то же. Окна без рамки
// вокруг названия передают `plain` — рамка выделяет название ЗАДАЧИ, а не
// слово «Команда».
//
// С 20.10.2026 шапка задачи и встречи — ОДНА строка: номер, название,
// действия, ×. Его слова: «поместить это всё в одну строку… строка должна
// сохранить чётко одну строку без смещений вниз во вторую». Номер стоял
// надписью НАД названием, а кнопки на телефоне переносились ПОД него —
// три строки на то, что читается одним взглядом. Поэтому длинное название
// обрезается многоточием, а целиком открывается нажатием на него (и
// подсказкой при наведении): на телефоне наведения нет, и без нажатия
// хвост названия был бы недоступен вовсе.
//
// Одна шапка на все окна по той же причине, по которой у задачи и встречи
// одна сводка (ItemFacts): «однотипное» значит одно и то же место, а две
// копии разметки разъедутся.
export default function ItemModalHead({
  kicker,
  kickerTitle,
  title,
  titleId,
  actions,
  onClose,
  closeId,
  plain,
  onRename,
}: {
  // «#111», «Встреча» — слева от названия, на той же строке.
  kicker?: ReactNode;
  kickerTitle?: string;
  title: ReactNode;
  titleId?: string;
  // Кнопки слева от ×: принудительное закрытие, удалить.
  actions?: ReactNode;
  onClose: () => void;
  closeId?: string;
  // Название без рамки — у служебных окон («Команда», «Разделы»).
  plain?: boolean;
  // Название можно поправить — у открытой задачи её постановщику. Тогда в
  // рамке названия стоит карандаш (28.10.2026, его слова: «сделай удобный
  // значок в поле названия задачи, понятный! Что можно отредактировать или
  // дополнить название задачи»). Без него название только читается.
  onRename?: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const full = typeof title === "string" ? title : undefined;
  const renamable = !plain && !!onRename && full !== undefined;
  // Правка идёт в той же рамке, что и название: поле встаёт на его место,
  // Enter или щелчок мимо сохраняют, Escape отменяет — и только правку, а не
  // окно (preventDefault снимает «запрос на закрытие» у <dialog>, см.
  // useEscapeToClose). Пустое название не сохраняется: задача без названия
  // на доске — пустой кубик.
  const [draft, setDraft] = useState<string | null>(null);
  const renaming = draft !== null;
  const doneRef = useRef(false);
  function startRename() {
    if (!renamable) return;
    doneRef.current = false;
    setDraft(full ?? "");
  }
  function finishRename(save: boolean) {
    if (doneRef.current || draft === null) return;
    doneRef.current = true;
    const next = draft.trim();
    if (save && next && next !== full) onRename?.(next);
    setDraft(null);
  }
  // Название раскрывается плавно (21.10.2026: «большое описание плавно
  // спокойно выплывало, без резких рывков»), а номер и кнопки при этом стоят
  // на месте — шапка выровнена по верху, а не по центру, иначе они съезжали
  // к середине развёрнутого названия.
  //
  // Раскрывается только то, что НЕ влезло (21.10.2026: «когда название
  // влазит в стандартную рамку, оно было не кликабельно»). Короткое
  // название при нажатии всё равно переходило в .open, а развёрнутая рамка
  // на долю пикселя выше свёрнутой — и описание с обсуждением под шапкой
  // вздрагивали без всякой пользы. Влезает ли, меряется по самой рамке
  // (scrollWidth против clientWidth) при каждом изменении её ширины и
  // текста, и пишется в data-overflow прямо в DOM: это знание о раскладке,
  // а не состояние, и перерисовка ради него не нужна.
  useEffect(() => {
    const el = titleRef.current;
    if (plain || !el) return;
    const measure = () => {
      if (el.classList.contains("open")) return; // развёрнутое всегда «влезает»
      el.dataset.overflow = el.scrollWidth > el.clientWidth + 1 ? "1" : "0";
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // После правки рамка названия — новый узел, и мерить надо его.
  }, [plain, title, renaming]);
  function toggle() {
    const el = titleRef.current;
    if (!open && el?.dataset.overflow !== "1") return;
    if (open) shrink(el, { withoutClass: "open" }, () => setOpen(false));
    else grow(el, () => setOpen(true));
  }
  return (
    <div className={"item-head" + (plain ? " plain-head" : " one-line")}>
      {!plain && kicker && (
        <span className="item-head-kicker" title={kickerTitle}>
          {kicker}
        </span>
      )}
      <div className={"item-head-main" + (renamable ? " renamable" : "")}>
        {plain && kicker && <div className="item-head-kicker">{kicker}</div>}
        {renaming ? (
          <AutoGrowTextarea
            id="taskTitleEdit"
            className="item-head-title-input"
            singleLine
            focusAtEnd
            value={draft}
            onChange={setDraft}
            onEnter={() => finishRename(true)}
            onBlur={() => finishRename(true)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              finishRename(false);
            }}
          />
        ) : (
          <>
            <h2
              id={titleId}
              ref={titleRef}
              className={"item-head-title" + (plain ? " plain" : "") + (open ? " open" : "")}
              title={!plain && !open ? full : undefined}
              onClick={plain ? undefined : toggle}
              onDoubleClick={renamable ? startRename : undefined}
            >
              {title}
            </h2>
            {renamable && (
              <button
                type="button"
                className="item-head-rename"
                id="renameTaskBtn"
                title="Изменить название"
                aria-label="Изменить название"
                onClick={startRename}
              >
                <Icon name="edit" size={16} />
                {/* Словом — на компьютере, где место есть: значок один
                    угадывают, со словом его читают. */}
                <span className="item-head-rename-word">Изменить</span>
              </button>
            )}
          </>
        )}
      </div>
      <div className="item-head-actions">
        {actions}
        <button type="button" className="item-head-close" id={closeId} title="Закрыть (Esc)" aria-label="Закрыть" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
