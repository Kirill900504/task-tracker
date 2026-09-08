"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// On a phone the desktop header cost half the screen: a logo, eight buttons
// wrapped onto three rows, and the quote. Here it is one row — who and when,
// search, and everything else behind «…», which is where buttons you press
// once a month belong.

export type MobileMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  // Shown as the current state rather than an action (notifications already
  // granted, for instance).
  disabled?: boolean;
};

export default function MobileHeader({
  clockText,
  onSearch,
  items,
}: {
  clockText: string;
  onSearch: () => void;
  items: MobileMenuItem[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="mobile-header" id="mobileHeader">
      <div className="mobile-brand">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
        <img className="mobile-logo" src="/favicon.png" alt="РОКАС" />
        <div className="mobile-brand-text">
          <div className="mobile-title">РОКАС</div>
          <div className="mobile-date">{clockText}</div>
        </div>
      </div>
      <button className="mobile-icon-btn" id="mobileSearchBtn" aria-label="Поиск" onClick={onSearch}>
        🔍
      </button>
      <button
        className="mobile-icon-btn"
        id="mobileMoreBtn"
        aria-label="Ещё"
        ref={buttonRef}
        onClick={() => {
          setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
          setMenuOpen((v) => !v);
        }}
      >
        ⋯
      </button>

      {menuOpen &&
        anchor &&
        createPortal(
          <>
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
                  {item.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </header>
  );
}
