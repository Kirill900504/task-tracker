"use client";

import Dropdown from "./Dropdown";
import { OPEN_TASK_NUMBER_EVENT } from "@/lib/chatText";

// «Ждёт задачу» — зависимость одной задачи от другой (миграция 0061).
//
// Предложение 3 от 13.10.2026, одобрено 14.10.2026: «Б ждёт А» — смету не
// начать без прайса. Выбирается из ОТКРЫТЫХ задач с номером: номер ставит
// база, то есть такая задача уже точно в облаке, и связь с ней не упадёт
// на внешнем ключе при отправке. Ставит и снимает постановщик; остальным —
// строкой с номером, по которому та задача открывается.
export type WaitOption = { id: string; number: number; title: string };

export default function TaskWaitsFor({
  value,
  options,
  editable,
  onChange,
}: {
  value: string;
  options: WaitOption[];
  editable: boolean;
  onChange: (id: string) => void;
}) {
  const current = options.find((o) => o.id === value);
  if (!editable) {
    if (!value) return null;
    return (
      <div className="waits-line" id="taskWaitsFor">
        <span className="fact-label">Ждёт задачу</span>{" "}
        {current ? (
          <button type="button" className="chat-task-link" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TASK_NUMBER_EVENT, { detail: current.number }))}>
            #{current.number} {current.title}
          </button>
        ) : (
          <span className="fact-note">задачу, которую вы не видите или уже закрытую</span>
        )}
      </div>
    );
  }
  return (
    <div className="field waits-field" id="taskWaitsFor">
      <label>Ждёт задачу</label>
      <Dropdown
        id="fWaitsFor"
        value={value || ""}
        onChange={onChange}
        options={[
          { value: "", label: "Ничего не ждёт" },
          ...options.map((o) => ({ value: o.id, label: `#${o.number} ${o.title}` })),
          // Ждёт уже закрытую или невидимую задачу — выбор показывает это
          // словами, а не пустым полем.
          ...(value && !current ? [{ value, label: "Задача закрыта или не видна" }] : []),
        ]}
      />
    </div>
  );
}
