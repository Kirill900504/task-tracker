"use client";

import { useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import ItemModalHead from "./ItemModalHead";
import { tourSteps } from "@/lib/welcomeTour";

// Окно стартового знакомства — слова и правило «кому» живут в
// lib/welcomeTour, здесь только листание карточек.
//
// «Пропустить» и × закрывают его так же, как «Начать работу»: знакомство
// считается пройденным, и само больше не откроется — навязанное второй раз
// окно читается как поломка. Вернуться к нему можно из личного кабинета.
// Последняя карточка ведёт в «Мои данные» — это следующий шаг человека.

export default function WelcomeTour({
  isOwner,
  onClose,
  onOpenProfile,
}: {
  isOwner: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  const steps = tourSteps({ isOwner });
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;

  return (
    <Modal id="welcomeTour" onClose={onClose} dismissOnBackdrop={false}>
      <div className="modal tour-modal">
        <ItemModalHead plain title={<>Знакомство с трекером</>} closeId="tourCloseBtn" onClose={onClose} />
        <div className="tour-card" key={step.id} data-step={step.id}>
          <div className="tour-icon" aria-hidden>
            <Icon name={step.icon} size={26} />
          </div>
          <h2 className="tour-title">{step.title}</h2>
          {step.text.map((line) => (
            <p key={line} className="tour-text">
              {line}
            </p>
          ))}
        </div>
        {/* Точки — где мы и сколько осталось; по ним можно перейти сразу. */}
        <div className="tour-dots" role="tablist" aria-label="Шаги знакомства">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}. ${s.title}`}
              className={"tour-dot" + (i === index ? " on" : "")}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <div className="modal-actions tour-actions">
          {index > 0 ? (
            <button type="button" className="btn" id="tourBackBtn" onClick={() => setIndex(index - 1)}>
              Назад
            </button>
          ) : (
            <button type="button" className="btn" id="tourSkipBtn" onClick={onClose}>
              Пропустить
            </button>
          )}
          {last ? (
            <span className="tour-finish">
              <button type="button" className="btn" id="tourDoneBtn" onClick={onClose}>
                Начать работу
              </button>
              <button
                type="button"
                className="btn btn-primary"
                id="tourProfileBtn"
                onClick={() => {
                  onClose();
                  onOpenProfile();
                }}
              >
                Заполнить «Мои данные»
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-primary" id="tourNextBtn" onClick={() => setIndex(index + 1)}>
              Далее <span className="tour-count">{index + 1}/{steps.length}</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
