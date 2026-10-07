"use client";

import type { Idea } from "@/types/tracker";
import Modal from "./Modal";
import Icon from "./Icon";

// Разбор мыслей: по одной, три исхода. Почему без «вычеркнуть» и почему
// по пятницам — см. lib/ideaReview.
//
// По одной, а не списком: список из двадцати мыслей с кнопками у каждой —
// это та же панель, которую и так не разбирают. Одна мысль на экране
// задаёт ровно один вопрос — «что с ней делать», — и ответ занимает одно
// нажатие.

export default function IdeaReviewModal({
  queue,
  total,
  onTask,
  onMeeting,
  onKeep,
  onClose,
}: {
  // Ещё не разобранные, первая — текущая.
  queue: Idea[];
  // Сколько было в начале разбора — для «3 из 12».
  total: number;
  onTask: (idea: Idea) => void;
  onMeeting: (idea: Idea) => void;
  onKeep: (idea: Idea) => void;
  onClose: () => void;
}) {
  const idea = queue[0];
  return (
    <Modal onClose={onClose} id="ideaReviewModal">
      <div className="modal idea-review">
        <h2>
          Разбор мыслей{" "}
          {idea && (
            <span className="count">
              {total - queue.length + 1} из {total}
            </span>
          )}
        </h2>
        {idea ? (
          <>
            <p className="field-hint">Записано {idea.createdAt}. Что с ней делаем?</p>
            <div className="idea-review-text">{idea.text}</div>
            <div className="idea-review-actions">
              <button type="button" className="btn btn-primary" onClick={() => onTask(idea)}>
                <Icon name="plus" size={14} /> В задачу
              </button>
              <button type="button" className="btn" onClick={() => onMeeting(idea)}>
                Во встречу
              </button>
              <button type="button" className="btn" onClick={() => onKeep(idea)}>
                Оставить
              </button>
            </div>
          </>
        ) : (
          <div className="empty">Всё разобрано. Следующий разбор — в пятницу.</div>
        )}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            {idea ? "Потом" : "Закрыть"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
