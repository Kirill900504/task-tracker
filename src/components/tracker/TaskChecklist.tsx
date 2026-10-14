"use client";

import { useState } from "react";
import Icon from "./Icon";
import { useTaskChecklist } from "@/hooks/useTaskChecklist";

// Чек-лист задачи — шаги с галочками, видные всем на задаче.
//
// Предложение 1 от 13.10.2026, одобрено 14.10.2026: «сделали 3 из 5 шагов»
// — ход работы без единого сообщения. Стоит под описанием: описание
// говорит, ЧТО сделать, чек-лист — из чего это состоит.
//
// Отмечают и дописывают постановщик, исполнители и соисполнители;
// наблюдатель только видит; у закрытой задачи — только просмотр. Те же
// границы стоят в базе (миграция 0059), а здесь кнопок, в которых база
// откажет, просто нет: отказ RLS молчалив.
export default function TaskChecklist({
  taskId,
  canWork,
  isAuthor,
  myUserId,
  closed,
}: {
  taskId: string;
  canWork: boolean;
  isAuthor: boolean;
  myUserId: string;
  closed: boolean;
}) {
  const list = useTaskChecklist(taskId);
  const [draft, setDraft] = useState("");
  const editable = canWork && !closed;
  const done = list.items.filter((i) => i.done).length;

  // Пустой чек-лист тому, кто не может его вести, нечего показать.
  if (!list.items.length && !editable) return null;

  return (
    <div className="checklist-block" id="taskChecklist">
      <div className="desc-head">
        <span className="fact-label">Чек-лист</span>
        {list.items.length > 0 && (
          <span className={"checklist-count" + (done === list.items.length ? " all" : "")}>
            {done} из {list.items.length}
          </span>
        )}
      </div>
      {list.items.length > 0 && (
        <div className="checklist-bar" aria-hidden>
          <span style={{ width: `${Math.round((done / list.items.length) * 100)}%` }} />
        </div>
      )}
      <ul className="checklist-list">
        {list.items.map((item) => (
          <li key={item.id} className={"checklist-item" + (item.done ? " done" : "")}>
            <button
              type="button"
              className={"check" + (item.done ? " checked" : "")}
              disabled={!editable}
              aria-pressed={item.done}
              title={item.done ? "Снять отметку" : "Отметить сделанным"}
              onClick={() => void list.toggle(item.id, !item.done)}
            >
              {item.done ? "✓" : ""}
            </button>
            <span className="checklist-text">{item.text}</span>
            {editable && (isAuthor || item.authorId === myUserId || item.id.startsWith("tmp-")) && (
              <button type="button" className="checklist-del" title="Убрать шаг" aria-label="Убрать шаг" onClick={() => void list.remove(item.id)}>
                <Icon name="close" size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <input
          className="checklist-add"
          id="checklistAdd"
          placeholder="Добавить шаг — Enter"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            void list.add(text);
          }}
        />
      )}
      {list.error && <div className="ms-answer-error">{list.error}</div>}
    </div>
  );
}
