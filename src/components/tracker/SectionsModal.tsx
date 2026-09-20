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

  async function rename(section: Section) {
    const name = await ask.ask({
      title: "Раздел",
      question: "Как он должен называться?",
      value: section.name,
      okText: "Сохранить",
      required: "У раздела должно быть название.",
    });
    if (!name?.trim() || name.trim() === section.name) return;
    onSave({ ...section, name: name.trim() });
  }

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
          Правая кнопка по разделу в трекере заводит новую задачу с теми, кто перечислен здесь. Левая — отбирает задачи этого раздела.
        </p>

        {failed && <div className="ms-answer-error">{failed}</div>}

        {sorted.map((section) => {
          const bound = links.forSection(section.id);
          const open = openFor === section.id;
          return (
            <div key={section.id} className="section-row">
              <div className="section-row-head">
                <span className={"section-dot" + (section.kind === "personal" ? " personal" : "")} />
                <span className="section-row-name">{section.name}</span>
                <span className="section-row-count">
                  {bound.length ? `${bound.length} чел.` : "никого"}
                </span>
                <button type="button" className="btn btn-small" onClick={() => setOpenFor(open ? null : section.id)}>
                  {open ? "Свернуть" : "Ответственные"}
                </button>
                <button type="button" className="btn btn-small" onClick={() => void rename(section)}>
                  Название
                </button>
                <button type="button" className="btn btn-small" onClick={() => void changeKind(section)}>
                  {section.kind === "personal" ? "Личный" : "Рабочий"}
                </button>
                <button type="button" className="btn btn-small btn-danger" onClick={() => onDelete(section)}>
                  Удалить
                </button>
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
