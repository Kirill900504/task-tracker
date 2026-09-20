"use client";

import { useState } from "react";
import type { Section } from "@/types/tracker";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import { useSectionAssignees } from "@/hooks/useSectionAssignees";
import type { PersonOption } from "@/hooks/useTaskParticipants";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { useAsk } from "@/components/Ask";
import Modal from "./Modal";
import Icon from "./Icon";

// «Разделы» — одно окно на всё, что с ними делают.
//
// Переименование и удаление жили в меню по правой кнопке прямо на строке
// разделов. Правую кнопку забрал куда более частый случай: «если тыкаешь
// правой — сразу вылазило окно создания новой задачи с уже выделенными
// исполнителями». Редкое действие уступило место частому, а само переехало
// сюда — вместе с тем, чего раньше не было вовсе: привязкой людей к
// разделу.
//
// Всё окно целиком — админское (миграция 0036). Руководителю его не
// открыть: кнопки, которая его открывает, у него нет, а база откажет в
// любом случае.

const ROLE_LABEL: Record<TaskParticipantRole, string> = {
  executor: "Исполнитель",
  coexecutor: "Соисполнитель",
  watcher: "Наблюдатель",
};

export default function SectionsModal({
  sections,
  people,
  ownerId,
  onClose,
  onSave,
  onDelete,
}: {
  sections: Section[];
  // Список людей приходит пропсом, а не своим хуком, и это не мелочь:
  // useTaskParticipants открывает realtime-канал с постоянным именем, а
  // второй такой же канал Supabase не заводит — он падает словами
  // «cannot add postgres_changes callbacks after subscribe()», и падает
  // не тихо, а вместе со всем экраном. Панель задач этот хук уже держит;
  // окну достаточно списка.
  people: PersonOption[];
  // Чьё пространство: строка привязки заводится в нём, а не в том, откуда
  // нажали. У владельца это он сам.
  ownerId: string;
  onClose: () => void;
  onSave: (section: Section) => void;
  onDelete: (section: Section) => void;
}) {
  const ask = useAsk();
  const links = useSectionAssignees();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [failed, setFailed] = useState("");

  const sorted = [...sections].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  async function changeKind(section: Section) {
    const kind = await ask.choose({
      title: "Какой это раздел",
      question: `«${section.name}» — рабочий или личный?`,
      note: "Личные разделы не попадают в сводки и отчёты по работе.",
      options: [
        { value: "work", label: "Рабочий" },
        { value: "personal", label: "Личный" },
      ],
    });
    if (kind === null || kind === section.kind) return;
    onSave({ ...section, kind: kind === "personal" ? "personal" : "work" });
  }

  async function addPerson(section: Section) {
    const taken = new Set(links.forSection(section.id).map((r) => r.assigneeId));
    const free = sortByPeopleOrder(
      people.filter((p) => !taken.has(p.id)),
      (p) => p.name,
    );
    if (!free.length) {
      await ask.say({ title: "Все уже здесь", question: "В этом разделе уже перечислены все, кто есть в трекере." });
      return;
    }
    const who = await ask.choose({
      title: "Ответственный за раздел",
      question: `Кого добавить в «${section.name}»?`,
      options: free.slice(0, 12).map((p) => ({ value: p.id, label: p.name })),
    });
    if (!who) return;
    const role = await ask.choose({
      title: "Кем он будет",
      question: "Как его подставлять в новую задачу по этому разделу?",
      options: [
        { value: "executor", label: "Исполнитель" },
        { value: "coexecutor", label: "Соисполнитель" },
        { value: "watcher", label: "Наблюдатель" },
      ],
    });
    if (!role) return;
    try {
      setFailed("");
      await links.add(section.id, who, role as TaskParticipantRole, ownerId);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Не получилось сохранить");
    }
  }

  return (
    <Modal onClose={onClose} id="sectionsModal" dismissOnBackdrop={false}>
      {/* `.modal` — сама коробка окна; <dialog class="overlay"> это
          только затемнённый фон с display:flex, и без обёртки заголовок,
          строки и кнопки раскладывались по нему в строку. */}
      <div className="modal">
        <h2 id="sectionsTitle">Разделы</h2>
        <p className="modal-note">
          Название правится прямо здесь. Левая кнопка по разделу в трекере заводит новую задачу с теми, кто перечислен в нём, правая — отбирает его задачи.
        </p>

        {failed && <div className="ms-answer-error">{failed}</div>}

        {sorted.map((section) => {
          const bound = links.forSection(section.id);
          const open = openFor === section.id;
          return (
            <div key={section.id} className="section-row" data-section-id={section.id}>
              <div className="section-row-head">
                <span className={"section-dot" + (section.kind === "personal" ? " personal" : "")} />
                <SectionName section={section} onSave={onSave} />
                <div className="section-cell">
                  {/* Подпись кнопки не меняется от нажатия — меняется её вид:
                      «Ответственные» ↔ «Свернуть» двигали «Удалить» вправо и
                      влево под рукой, а это ровно то, чего он просил не
                      делать. Число рядом отвечает на тот же вопрос, что
                      отвечала снятая подпись «никого». */}
                  <button
                    type="button"
                    className={"btn btn-small section-btn-people" + (open ? " active" : "")}
                    title="Кого подставлять в новую задачу по этому разделу"
                    aria-expanded={open}
                    onClick={() => setOpenFor(open ? null : section.id)}
                  >
                    Люди <span className="pill">{bound.length}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-small section-btn-kind"
                    title="Рабочий или личный: личные разделы не попадают в сводки"
                    onClick={() => void changeKind(section)}
                  >
                    {section.kind === "personal" ? "Личный" : "Рабочий"}
                  </button>
                  <button type="button" className="btn btn-small btn-danger" onClick={() => onDelete(section)}>
                    Удалить
                  </button>
                </div>
              </div>

              {open && (
                <div className="section-row-people">
                  {bound.map((row) => {
                    const name = people.find((p) => p.id === row.assigneeId)?.name || "—";
                    return (
                      <span key={row.id} className="section-person">
                        {name}
                        <span className="section-person-role">{ROLE_LABEL[row.role].toLowerCase()}</span>
                        <button
                          type="button"
                          className="section-person-x"
                          title="Убрать из раздела"
                          onClick={() => void links.remove(row.id)}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  <button type="button" className="btn btn-small" onClick={() => void addPerson(section)}>
                    <Icon name="users" size={14} /> Добавить
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Название раздела правится на месте, а не в окне вопроса.
//
// Кнопка «Название» открывала `ask` с полем ввода — три нажатия и целое
// окно ради одного слова, и по ней же не было видно, что имя вообще можно
// менять: подпись называла поле, а не действие. Поле, в котором стоит само
// название, говорит это собой и заодно освобождает место в строке, из-за
// которого «Удалить» уезжала на вторую строку.
//
// Пишется сразу, как текст задачи: движок синхронизации сам склеивает
// подряд идущие правки, и ждать здесь нечего. Escape при этом закрывает
// всё окно (так устроен `useEscapeToClose` — он слушает в фазе перехвата),
// поэтому набранное не должно ждать ни «Сохранить», ни даже потери фокуса:
// к моменту Escape оно уже сохранено.
//
// Пустое имя — это не имя: в базу оно не уходит вовсе, а поле, оставленное
// пустым, возвращает прежнее, когда из него уходят. Иначе раздел без
// названия превратился бы в безымянную кнопку, которую нечем выбрать.
function SectionName({ section, onSave }: { section: Section; onSave: (section: Section) => void }) {
  const [draft, setDraft] = useState(section.name);

  function change(value: string) {
    setDraft(value);
    const name = value.trim();
    if (name && name !== section.name) onSave({ ...section, name });
  }

  return (
    <input
      className="section-row-name"
      value={draft}
      aria-label="Название раздела"
      title="Название раздела — правится прямо здесь"
      maxLength={40}
      onChange={(e) => change(e.target.value)}
      onBlur={() => {
        if (!draft.trim()) setDraft(section.name);
      }}
      onKeyDown={(e) => {
        // Enter здесь значит «закончил», а не «отправить форму»: сохранено
        // уже всё, и остаётся только убрать курсор из поля.
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
