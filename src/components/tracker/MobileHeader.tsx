"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import PopLayer from "./PopLayer";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import Icon, { type IconName } from "./Icon";

// On a phone the desktop header cost half the screen: a logo, eight buttons
// wrapped onto three rows, and the quote. Here it is one row — who and when,
// and ONE button beside them.
//
// Одна, а не две. Слова Кирилла 20.09.2026: «вместо кнопок Лупы и „…“
// оставить одну кнопку с картинкой команды». Лупа и «⋯» стояли рядом и
// обе не говорили ничего: «⋯» — это «здесь что-то есть», а поиск на
// телефоне открывают в разы реже, чем на компьютере, где под него есть
// клавиша. Теперь кнопка одна, у неё есть лицо (люди — то же, чем
// подписана «Команда» на компьютере), а поиск стоит первой строкой в её
// меню и никуда не делся.

export type MobileMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  // Значок строки меню. Эмодзи в подписях здесь больше нет: строки стоят
  // столбиком, и цветная наклейка от системы рядом со словом в шрифте
  // интерфейса выглядит приклеенной (правило про значки в CLAUDE.md).
  icon?: IconName;
  // Shown as the current state rather than an action (notifications already
  // granted, for instance).
  disabled?: boolean;
};

export default function MobileHeader({
  clockText,
  accountName,
  extra,
  items,
}: {
  clockText: string;
  // Имя того, кто сейчас вошёл — под датой, там же, где на компьютере
  // стоит кнопка личного кабинета. Слова Кирилла 23.09.2026: «чтоб каждый
  // видел, что они сидят под личным аккаунтом в системе» — на телефоне
  // до этого не было ни одной подсказки, чей это вход.
  accountName?: string;
  // Значки статуса (связь, отказ синхронизации) — перед основной кнопкой,
  // как в шапке компьютера. Слот, а не жёстко вшитый компонент: шапка не
  // должна знать про ConnectionStatus, чтобы не читать про облако там,
  // где речь про меню.
  extra?: ReactNode;
  items: MobileMenuItem[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEscapeToClose(() => setMenuOpen(false), menuOpen);

  return (
    <header className="mobile-header" id="mobileHeader">
      <div className="mobile-brand">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
        <img className="mobile-logo" src="/favicon.png" alt="РОКАС" />
        <div className="mobile-brand-text">
          <div className="mobile-title">РОКАС</div>
          <div className="mobile-date">{accountName ? `${accountName} · ${clockText}` : clockText}</div>
        </div>
      </div>
      {extra}
      <button
        className={"mobile-icon-btn" + (menuOpen ? " active" : "")}
        id="mobileMoreBtn"
        aria-label="Команда и настройки"
        aria-expanded={menuOpen}
        ref={buttonRef}
        onClick={() => {
          setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
          setMenuOpen((v) => !v);
        }}
      >
        <Icon name="users" size={19} />
      </button>

      {menuOpen &&
        anchor &&
        (
          <PopLayer>
            <div className="export-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="export-menu mobile-menu" id="mobileMoreMenu" style={{ top: anchor.bottom + 8 }}>
              {items.map((item) => (
                <button
                  key={item.id}
                  className="export-item"
                  disabled={item.disabled}
                  onClick={() => {
                    setMenuOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.icon && <Icon name={item.icon} size={16} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </PopLayer>
        )}
    </header>
  );
}
