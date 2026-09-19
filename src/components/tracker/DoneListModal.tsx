"use client";

import Modal from "./Modal";
import Icon from "./Icon";

// Завершённое — списком в отдельном окне.
//
// Просьба Кирилла 19.09.2026: «встречи, мысли и идеи — добавить маленькую
// стильную иконку (с зелёной галочкой, например) для показа завершённых
// встреч или мыслей, но в этом случае они должны показываться удобным
// дизайнерским списком в дополнительном окне, и добавь возможность
// закрытия кнопкой Esc».
//
// Почему не как было — общим переключателем «Завершённые», от которого
// вычеркнутые мысли и закрытые встречи подмешивались прямо в рабочие
// списки: панель, в которой половина строк перечёркнута, перестаёт быть
// списком дел. Завершённое смотрят изредка и с другой целью — вспомнить
// или вернуть, — и для этого нужен не режим, а окно.
//
// Esc закрывает его, как и всё остальное: окно построено на общем Modal,
// то есть на настоящем <dialog>, и правило работает само.

export type DoneItem = {
  id: string;
  title: string;
  // Дата и что от неё осталось: у встречи — итог, у мысли — когда
  // вычеркнули.
  note?: string;
  when?: string;
  onOpen?: () => void;
  onRestore?: () => void;
};

export default function DoneListModal({
  title,
  empty,
  items,
  restoreLabel = "Вернуть",
  onClose,
}: {
  title: string;
  empty: string;
  items: DoneItem[];
  restoreLabel?: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} id="doneListModal" className="done-list-modal">
      <h2>
        {title} <span className="count">{items.length}</span>
      </h2>

      {!items.length && <div className="empty">{empty}</div>}

      <div className="done-list">
        {items.map((item) => (
          <div key={item.id} className="done-list-row">
            <span className="done-list-mark">
              <Icon name="check" size={13} />
            </span>
            <button
              type="button"
              className="done-list-text"
              disabled={!item.onOpen}
              onClick={() => {
                item.onOpen?.();
                onClose();
              }}
            >
              <span className="done-list-title">{item.title}</span>
              {(item.when || item.note) && (
                <span className="done-list-note">
                  {item.when}
                  {item.when && item.note ? " · " : ""}
                  {item.note}
                </span>
              )}
            </button>
            {item.onRestore && (
              <button type="button" className="btn btn-small" onClick={item.onRestore}>
                {restoreLabel}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button className="btn" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Modal>
  );
}
