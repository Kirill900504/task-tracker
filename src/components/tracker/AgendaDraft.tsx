"use client";

import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";

// Повестка в форме НОВОЙ встречи (21.10.2026, его слова: «поле повестка
// должно быть доступно при создании любой встречи… блок повестка должен
// быть между названием встречи и датой»). До этого повестку можно было
// завести только у уже сохранённой встречи — то есть приглашение уходило
// людям без «что обсудим», и дописывали её, если вообще дописывали, потом.
//
// Пункты живут в форме, пока встреча не сохранена: таблица повестки
// (миграция 0048) держится за строку встречи, а её ещё нет. Пишет их
// MeetingsPanel после сохранения (saveAgendaDraft), ДО приглашения — чтобы
// повестка доехала до людей в самом приглашении.
//
// Выглядит и ведёт себя как повестка открытой встречи (MeetingAgenda):
// Enter добавляет пункт, тот же список. Набранное и не добавленное Enter'ом
// не теряется — форма заберёт его при сохранении (см. MeetingModal.save).

export default function AgendaDraft({
  items,
  onChange,
  text,
  onText,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  text: string;
  onText: (text: string) => void;
}) {
  function add() {
    const clean = text.trim();
    if (!clean) return;
    onChange([...items, clean.slice(0, 500)]);
    onText("");
  }
  return (
    <div className="field meeting-agenda" id="agendaDraft">
      <label>
        Повестка {items.length > 0 && <span className="count">{items.length}</span>}
      </label>
      {items.length > 0 && (
        <ol className="agenda-list agenda-draft-list">
          {items.map((item, i) => (
            <li key={i + ":" + item} className="agenda-item agenda-draft-item">
              <span className="agenda-text">{item}</span>
              <button
                type="button"
                className="chat-mini"
                aria-label="Убрать пункт"
                title="Убрать пункт"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="input-with-mic">
        <AutoGrowTextarea
          id="mAgenda"
          placeholder={items.length ? "Ещё пункт" : "Что обсудим?"}
          value={text}
          onChange={onText}
          singleLine
          onEnter={add}
        />
        <MicButton value={text} onChange={onText} title="Надиктовать пункт повестки" />
      </div>
    </div>
  );
}
