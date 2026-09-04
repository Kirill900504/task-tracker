"use client";

// Faithful port of the task modal from src/app/trackerMarkup.ts + the
// openModal()/saveTaskBtn/deleteTaskBtn/stopRecurBtn handlers in
// public/legacy-tracker.js. Kept on the same element ids (#overlay,
// #fTitle, #saveTaskBtn, etc.) so the existing e2e patterns keep working
// against the new UI with minimal changes.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { RecurKind, Section, Task, TaskPrefill } from "@/types/tracker";
import { uid } from "@/lib/uid";

const WEEKDAY_OPTIONS = [
  { value: "1", label: "Понедельник" },
  { value: "2", label: "Вторник" },
  { value: "3", label: "Среда" },
  { value: "4", label: "Четверг" },
  { value: "5", label: "Пятница" },
  { value: "6", label: "Суббота" },
  { value: "0", label: "Воскресенье" },
];
const MONTH_OPTIONS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
].map((label, i) => ({ value: String(i + 1), label }));

function emptyForm(task: Task | null, prefill?: TaskPrefill) {
  return {
    title: task?.title ?? prefill?.title ?? "",
    desc: task?.desc ?? prefill?.desc ?? "",
    assignee: task?.assignee ?? prefill?.assignee ?? "",
    sectionId: task?.sectionId ?? "",
    priority: task?.priority ?? prefill?.priority ?? "med",
    term: task?.term ?? prefill?.term ?? "short",
    deadline: task?.deadline ?? prefill?.deadline ?? "",
    recur: task?.recur ?? "none",
    recurWeekday: task?.recurWeekday || "1",
    recurMonthday: task?.recurMonthday ?? "",
    recurYearDay: task?.recurYearDay ?? "",
    recurYearMonth: task?.recurYearMonth || "1",
  };
}

export default function TaskModal({
  task,
  prefill,
  sections,
  assignees,
  onSave,
  onDelete,
  onClose,
  onAddAssignee,
  onRemoveAssignee,
  onAddSection,
  onRemoveSection,
}: {
  task: Task | null;
  prefill?: TaskPrefill;
  sections: Section[];
  assignees: string[];
  onSave: (task: Task) => void;
  onDelete: () => void;
  onClose: () => void;
  onAddAssignee: (name: string) => void;
  onRemoveAssignee: (name: string) => void;
  onAddSection: (section: Section) => void;
  onRemoveSection: (id: string) => void;
}) {
  const [form, setForm] = useState(() => emptyForm(task, prefill));

  // Esc closes the modal, same as legacy's global keydown handler.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isEditing = !!task;
  const assigneeOptions = form.assignee && !assignees.includes(form.assignee) ? [...assignees, form.assignee] : assignees;

  function save() {
    const title = form.title.trim();
    if (!title) {
      alert("Укажите название задачи");
      return;
    }
    const next: Task = {
      id: task?.id ?? uid(),
      title,
      desc: form.desc.trim(),
      assignee: form.assignee,
      sectionId: form.sectionId,
      priority: form.priority as Task["priority"],
      term: form.term as Task["term"],
      status: task?.status ?? "in_progress",
      deadline: form.deadline,
      recur: form.recur as RecurKind,
      recurWeekday: form.recurWeekday,
      recurMonthday: form.recurMonthday,
      recurYearDay: form.recurYearDay,
      recurYearMonth: form.recurYearMonth,
      lastCompletedOn: task?.lastCompletedOn ?? "",
      manualOrder: task?.manualOrder ?? null,
    };
    onSave(next);
    onClose();
  }

  function handleAddAssignee() {
    const v = prompt("Имя нового исполнителя:");
    if (!v) return;
    const name = v.trim();
    if (!name) return;
    onAddAssignee(name);
    setForm((f) => ({ ...f, assignee: name }));
  }

  function handleRemoveAssignee() {
    if (!form.assignee) return;
    if (confirm(`Удалить исполнителя «${form.assignee}» из списка? Уже созданные задачи сохранят его имя, но выбрать его для новых задач будет нельзя.`)) {
      onRemoveAssignee(form.assignee);
    }
  }

  function handleAddSection() {
    const v = prompt("Название нового раздела:");
    if (!v) return;
    const name = v.trim();
    if (!name) return;
    const isPersonal = confirm("Это личный раздел (не рабочий)? ОК — личный, Отмена — рабочий.");
    const section: Section = { id: uid(), name, kind: isPersonal ? "personal" : "work", sortOrder: sections.length };
    onAddSection(section);
    setForm((f) => ({ ...f, sectionId: section.id }));
  }

  function handleRemoveSection() {
    const section = sections.find((s) => s.id === form.sectionId);
    if (!section) return;
    if (confirm(`Удалить раздел «${section.name}»? Задачи в нём останутся, но без раздела.`)) {
      onRemoveSection(section.id);
      setForm((f) => (f.sectionId === section.id ? { ...f, sectionId: "" } : f));
    }
  }

  function handleStopRecur() {
    if (!confirm("Прекратить повторение этой задачи? Она останется как обычная разовая задача с текущим статусом.")) return;
    setForm((f) => ({ ...f, recur: "none", recurWeekday: "1", recurMonthday: "", recurYearDay: "", recurYearMonth: "1" }));
    if (task) onSave({ ...task, recur: "none", recurWeekday: "1", recurMonthday: "", recurYearDay: "", recurYearMonth: "1" });
  }

  const showStopRecur = isEditing && form.recur !== "none";

  return createPortal(
    <div className="overlay open" id="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 id="modalTitle">{isEditing ? "Редактировать задачу" : "Новая задача"}</h2>
        <input type="hidden" id="taskId" value={task?.id ?? ""} readOnly />

        <div className="field">
          <label>Название задачи</label>
          <input
            type="text"
            id="fTitle"
            placeholder="Например: Согласовать прайс с поставщиком"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="field">
          <label>Описание (необязательно)</label>
          <textarea id="fDesc" placeholder="Детали, контекст…" value={form.desc} onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))} />
        </div>

        <div className="field">
          <label>Исполнитель</label>
          <div className="select-with-add">
            <select id="fAssignee" value={form.assignee} onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}>
              <option value=""></option>
              {assigneeOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button className="btn" id="addAssigneeBtn" type="button" title="Добавить исполнителя" onClick={handleAddAssignee}>
              +
            </button>
            <button className="btn btn-danger-ghost" id="removeAssigneeBtn" type="button" title="Удалить выбранного исполнителя" onClick={handleRemoveAssignee}>
              −
            </button>
          </div>
        </div>

        <div className="field">
          <label>Раздел</label>
          <div className="select-with-add">
            <select id="fSection" value={form.sectionId} onChange={(e) => setForm((f) => ({ ...f, sectionId: e.target.value }))}>
              <option value="">Без раздела</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn" id="addSectionBtn" type="button" title="Добавить раздел" onClick={handleAddSection}>
              +
            </button>
            <button className="btn btn-danger-ghost" id="removeSectionBtn" type="button" title="Удалить выбранный раздел" onClick={handleRemoveSection}>
              −
            </button>
          </div>
        </div>

        <div className="row2">
          <div className="field">
            <label>Приоритет</label>
            <select id="fPriority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Task["priority"] }))}>
              <option value="high">Высокий</option>
              <option value="med">Средний</option>
            </select>
          </div>
          <div className="field">
            <label>Срочность</label>
            <select id="fTerm" value={form.term} onChange={(e) => setForm((f) => ({ ...f, term: e.target.value as Task["term"] }))}>
              <option value="short">Краткосрочная</option>
              <option value="long">Долгосрочная</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label>Дедлайн / дата</label>
          <input type="date" id="fDeadline" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </div>

        <div className="field">
          <label>Повторение задачи</label>
          <select id="fRecur" value={form.recur} onChange={(e) => setForm((f) => ({ ...f, recur: e.target.value as RecurKind }))}>
            <option value="none">Не повторяется</option>
            <option value="daily">Каждый день</option>
            <option value="weekly">Каждую неделю (день недели)</option>
            <option value="monthly">Каждый месяц (число)</option>
            <option value="yearly">Каждый год (число и месяц)</option>
          </select>

          <div className={"recur-config" + (form.recur === "weekly" ? " open" : "")} id="recurWeekly">
            <label>День недели</label>
            <select id="fRecurWeekday" value={form.recurWeekday} onChange={(e) => setForm((f) => ({ ...f, recurWeekday: e.target.value }))}>
              {WEEKDAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className={"recur-config" + (form.recur === "monthly" ? " open" : "")} id="recurMonthly">
            <label>Число месяца</label>
            <input
              type="text"
              id="fRecurMonthday"
              placeholder="Например: 5 или 28"
              value={form.recurMonthday}
              onChange={(e) => setForm((f) => ({ ...f, recurMonthday: e.target.value }))}
            />
          </div>
          <div className={"recur-config" + (form.recur === "yearly" ? " open" : "")} id="recurYearly">
            <label>День и месяц</label>
            <div className="row2">
              <input
                type="text"
                id="fRecurYearDay"
                placeholder="Число (напр. 15)"
                value={form.recurYearDay}
                onChange={(e) => setForm((f) => ({ ...f, recurYearDay: e.target.value }))}
              />
              <select id="fRecurYearMonth" value={form.recurYearMonth} onChange={(e) => setForm((f) => ({ ...f, recurYearMonth: e.target.value }))}>
                {MONTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={"stop-recur-row" + (showStopRecur ? " show" : "")} id="stopRecurRow">
            <button className="btn btn-danger-ghost btn-small" id="stopRecurBtn" type="button" onClick={handleStopRecur}>
              ⏹ Прекратить повторение
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <div className="left">
            {isEditing && (
              <button
                className="btn btn-danger-ghost"
                id="deleteTaskBtn"
                onClick={() => {
                  if (confirm("Удалить эту задачу?")) {
                    onDelete();
                    onClose();
                  }
                }}
              >
                Удалить
              </button>
            )}
          </div>
          <div className="left">
            <button className="btn" id="cancelBtn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn btn-primary" id="saveTaskBtn" onClick={save}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
