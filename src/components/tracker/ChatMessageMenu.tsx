"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

// Меню сообщения в обсуждении — правой кнопкой, как в мессенджере.
//
// До этого под каждым сообщением стояла строка «☺ изменить убрать»: три
// подписи словами, видные всегда и у каждой реплики сразу. В ветке из
// десяти сообщений это десять строк служебного текста вперемешку с самим
// разговором, и читать его приходится поверх них. Кирилл попросил сделать
// «по аналогии с телеграм», и там это решено ровно наоборот: под
// сообщением не видно ничего, а всё, что с ним можно сделать, живёт в
// меню по правой кнопке.
//
// Сверху меню — ряд эмодзи в одно нажатие: реакция ставится чаще всех
// остальных действий вместе взятых, и ради неё открывать вложенный список
// не стоит. Набор тот же фиксированный (REACTIONS), по той же причине, по
// которой он фиксирован вообще: реакция уезжает в мессенджер строкой под
// сообщением, и произвольный эмодзи там превращается в квадрат.
//
// На телефоне правой кнопки нет — там это долгое нажатие (см. ItemChat).
// Поэтому меню принимает не событие, а точку: откуда бы его ни позвали,
// оно открывается там, где палец или курсор.

export type ChatMenuAction = { id: string; label: string; danger?: boolean; onSelect: () => void };

export default function ChatMessageMenu({
  at,
  emojis,
  activeEmojis,
  onPickEmoji,
  actions,
  onClose,
}: {
  at: { x: number; y: number };
  emojis: readonly string[];
  // Реакции, которые этот человек уже поставил: нажатие по ним снимает
  // реакцию, а не ставит вторую, и выглядеть они должны нажатыми.
  activeEmojis: string[];
  onPickEmoji: (emoji: string) => void;
  actions: ChatMenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Место считается ПОСЛЕ отрисовки и до кадра: меню у нижнего края экрана
  // должно открыться вверх, а у правого — влево, и узнать его размер можно
  // только измерив. Тот же приём, что и у ActionMenu.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, at.x), window.innerWidth - width - margin);
    const top = at.y + height + margin > window.innerHeight ? Math.max(margin, at.y - height) : at.y;
    setPos({ left, top });
  }, [at.x, at.y]);

  useEscapeToClose(onClose);

  return createPortal(
    <>
      <div className="chat-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="chat-menu"
        ref={ref}
        role="menu"
        // Пока место не посчитано, меню уже нарисовано (иначе его нечем
        // мерить), но невидимо — иначе виден прыжок из угла на место.
        style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
      >
        <div className="chat-menu-emojis">
          {emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={"chat-menu-emoji" + (activeEmojis.includes(emoji) ? " mine" : "")}
              title={activeEmojis.includes(emoji) ? "Убрать реакцию" : "Поставить реакцию"}
              onClick={() => {
                onPickEmoji(emoji);
                onClose();
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
        {actions.length > 0 && (
          <div className="chat-menu-actions">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                className={"chat-menu-item" + (a.danger ? " danger" : "")}
                onClick={() => {
                  a.onSelect();
                  onClose();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
