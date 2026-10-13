"use client";

import type { ReactNode } from "react";
import Icon from "./Icon";

// Шапка открытой задачи и встречи: номер, название в рамке, действия и ×.
//
// Слова Кирилла 13.10.2026: «название задачи тоже визуально оформи, чтобы
// чётко выделялось и бросалось в глаза… возможно тоже с каким-то контуром»;
// «любые изменения, вносимые в уже созданную задачу, должны автоматически в
// ней сохраняться, то есть кнопки „Удалить, Сохранить, Отмена“ не нужны…
// но в правом верхнем углу должен быть крестик для закрытия окна (помимо
// Esc)»; «кнопку „закрыть волевым решением“ перенеси в правый верхний угол
// (слева от значка закрытия окна)».
//
// Одна шапка на оба окна по той же причине, по которой у них одна сводка
// (ItemFacts): «однотипное» значит одно и то же место, а две копии
// разметки разъедутся.
export default function ItemModalHead({
  kicker,
  title,
  titleId,
  actions,
  onClose,
  closeId,
}: {
  // «Задача #111», «Встреча» — над названием, мелко.
  kicker?: ReactNode;
  title: string;
  titleId: string;
  // Кнопки слева от ×: принудительное закрытие, отложить, удалить.
  actions?: ReactNode;
  onClose: () => void;
  closeId?: string;
}) {
  return (
    <div className="item-head">
      <div className="item-head-main">
        {kicker && <div className="item-head-kicker">{kicker}</div>}
        <h2 id={titleId} className="item-head-title">
          {title}
        </h2>
      </div>
      <div className="item-head-actions">
        {actions}
        <button type="button" className="item-head-close" id={closeId} title="Закрыть (Esc)" aria-label="Закрыть" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
