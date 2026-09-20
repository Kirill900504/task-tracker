"use client";

import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

// The phone gets its own frame: one section on screen at a time, chosen from
// a bar under the thumb, instead of the desktop's three columns stacked into
// one endless scroll (where reaching the meetings meant scrolling past every
// task).
//
// The sections themselves are the very same panels the desktop renders — the
// difference is the navigation around them, not a second implementation of
// the tracker.

export type MobileTab = "today" | "tasks" | "meetings" | "ideas" | "review";

// Вкладка, с которой начинается каждая сессия. Слова Кирилла 20.09.2026:
// «Задачи… он же всегда должен быть главной страницей и на с него
// начинаться каждая сессия». Держится здесь, рядом с самим списком, а не
// строкой useState в корне: порядок и точка входа — одно решение.
export const DEFAULT_MOBILE_TAB: MobileTab = "tasks";

// Порядок продиктован Кириллом 20.09.2026 и повторяет расположение блоков
// на компьютере: встречи слева, задачи посередине, мысли справа. То, чего
// на компьютере нет отдельным блоком, — приёмка и «Сегодня» — встаёт по
// частоте: приёмка ждёт решения каждый день, «Сегодня» — это взгляд, а не
// работа, и он крайний.
//
// Значки — контурные из Icon.tsx, а не эмодзи. Эмодзи рисует система: на
// Windows это цветные наклейки своего размера и своего цвета, который не
// темнеет вместе с неактивной вкладкой, — пять разных картинок в ряд
// вместо одного набора (см. правило про шрифты и значки в CLAUDE.md).
const TABS: { id: MobileTab; label: string; icon: IconName }[] = [
  { id: "meetings", label: "Встречи", icon: "calendar" },
  { id: "tasks", label: "Задачи", icon: "tasks" },
  { id: "review", label: "Приёмка", icon: "inbox" },
  { id: "ideas", label: "Мысли", icon: "bulb" },
  { id: "today", label: "Сегодня", icon: "today" },
];

export default function MobileShell({
  tab,
  onTabChange,
  badges,
  children,
}: {
  tab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  // Small counts on the tabs — how much is waiting there, so you can see it
  // without opening each one.
  badges?: Partial<Record<MobileTab, number>>;
  children: ReactNode;
}) {
  return (
    <>
      <main className="mobile-main" id="mobileMain">
        {children}
      </main>
      <nav className="mobile-nav" id="mobileNav">
        {TABS.map((t) => {
          const count = badges?.[t.id];
          return (
            <button
              key={t.id}
              className={"mobile-tab" + (tab === t.id ? " active" : "")}
              data-tab={t.id}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => onTabChange(t.id)}
            >
              {/* Подсветка активной вкладки — заливка под значком, а не
                  полоска по верхнему краю панели: полоска толщиной в два
                  пикселя на телефоне читается как край экрана, а не как
                  ответ на вопрос «где я сейчас». */}
              <span className="mobile-tab-icon">
                <Icon name={t.icon} size={21} />
                {!!count && <span className="mobile-tab-badge">{count > 99 ? "99+" : count}</span>}
              </span>
              <span className="mobile-tab-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
