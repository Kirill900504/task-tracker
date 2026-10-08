"use client";

import Modal from "./Modal";
import Icon from "./Icon";
import type { Idea } from "@/types/tracker";
import { stateLabel, type SentTo } from "@/lib/ideaRecipients";

// «Отправленные» — куда уходит мысль после «Отправить».
//
// Решение Кирилла 23.09.2026: отправленная мысль «исчезает из списка
// автора сразу» — её отдали, и в рабочем списке она больше не его дело.
// Но вопрос «а что он с ней сделал» у автора остаётся, и ответ на него —
// здесь: та же форма, что у вычеркнутых (DoneListModal), только под
// каждой мыслью — кому ушла и что каждый ответил. Окно, а не режим списка,
// по той же причине, что у завершённого: смотрят изредка и с другой целью.
export default function SentIdeasModal({
  ideas,
  sentTo,
  onClose,
}: {
  // Свежие сверху — порядок задаёт тот, кто открывает.
  ideas: Idea[];
  sentTo: Record<string, SentTo[]>;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} id="sentIdeasModal">
      <div className="modal done-list-modal">
        <h2>
          Отправленные мысли <span className="count">{ideas.length}</span>
        </h2>

        {!ideas.length && <div className="empty">Отправленных мыслей нет.</div>}

        <div className="done-list">
          {ideas.map((idea) => (
            <div key={idea.id} className="done-list-row" data-sent-idea={idea.id}>
              <span className="done-list-mark">
                <Icon name="send" size={13} />
              </span>
              <div className="done-list-text sent-idea-text">
                <span className="done-list-title">{idea.text}</span>
                <span className="done-list-note">{idea.createdAt}</span>
                <span className="sent-idea-people">
                  {(sentTo[idea.id] || [])
                    .filter((s) => s.kind === "send")
                    .map((s) => (
                      <span key={s.name} className={"sent-idea-person state-" + s.state}>
                        {s.name} — {stateLabel(s.kind, s.state)}
                      </span>
                    ))}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}
