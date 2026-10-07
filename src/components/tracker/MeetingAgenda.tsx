"use client";

import { useEffect, useState } from "react";
import { useMeetingAgenda, type AgendaItem } from "@/hooks/useMeetingAgenda";
import { me } from "@/lib/me";
import { useAsk } from "@/components/Ask";
import AutoGrowTextarea from "./AutoGrowTextarea";
import Icon from "./Icon";

// Повестка в окне встречи (миграция 0048, п.3.1 предложений).
//
// До встречи — список пунктов, который дописывает каждый участник: «что
// обсудим» перестаёт жить в голове организатора. На встрече организатор
// пишет у пункта, что решили, — итог по пунктам, а не одним абзацем, — и
// пункт одним нажатием открывает форму задачи с этим текстом. Свой пункт
// автор может убрать; итог и «убрать» у любого пункта — у организатора.

export default function MeetingAgenda({
  meetingId,
  isOrganizer,
  closed,
  onTask,
}: {
  meetingId: string;
  isOrganizer: boolean;
  // Встреча уже прошла и закрыта: дописывать повестку поздно, а итоги и
  // задачи из пунктов остаются.
  closed: boolean;
  onTask?: (item: AgendaItem) => void;
}) {
  const { items, loaded, error, add, setNote, remove } = useMeetingAgenda(meetingId);
  const ask = useAsk();
  const [text, setText] = useState("");
  const [myId, setMyId] = useState("");
  useEffect(() => {
    let alive = true;
    void me().then((m) => alive && setMyId(m.userId));
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded && !items.length) return null;
  if (closed && !items.length) return null;

  async function editNote(item: AgendaItem) {
    const note = await ask.ask({
      title: item.text,
      question: "Что решили по этому пункту?",
      value: item.note,
      multiline: true,
      okText: "Записать",
    });
    if (note === null) return;
    void setNote(item.id, note);
  }

  return (
    <div className="field meeting-agenda" id="meetingAgenda">
      <label>
        Повестка {items.length > 0 && <span className="count">{items.length}</span>}
      </label>
      {items.length > 0 && (
        <ol className="agenda-list">
          {items.map((item) => {
            const canRemove = isOrganizer || (item.authorId && item.authorId === myId);
            return (
              <li key={item.id} className="agenda-item">
                <div className="agenda-text">{item.text}</div>
                {item.note && <div className="agenda-note">Решили: {item.note}</div>}
                <div className="agenda-actions">
                  {isOrganizer && (
                    <button type="button" className="btn btn-small" onClick={() => void editNote(item)}>
                      {item.note ? "Изменить итог" : "Итог"}
                    </button>
                  )}
                  {onTask && (
                    <button type="button" className="btn btn-small" onClick={() => onTask(item)}>
                      <Icon name="plus" size={12} /> В задачу
                    </button>
                  )}
                  {canRemove && !closed && (
                    <button type="button" className="btn btn-small btn-danger-ghost" aria-label="Убрать пункт" onClick={() => void remove(item.id)}>
                      Убрать
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {!closed && (
        <div className="agenda-add">
          <AutoGrowTextarea
            id="agendaInput"
            placeholder={items.length ? "Ещё пункт… Enter — добавить" : "Что обсудим? Enter — добавить пункт"}
            value={text}
            onChange={setText}
            singleLine
            onEnter={() => {
              void add(text);
              setText("");
            }}
          />
        </div>
      )}
      {error && <div className="ms-answer-error">{error}</div>}
    </div>
  );
}
