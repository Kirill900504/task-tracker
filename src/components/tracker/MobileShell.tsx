"use client";

import type { ReactNode } from "react";

// The phone gets its own frame: one section on screen at a time, chosen from
// a bar under the thumb, instead of the desktop's three columns stacked into
// one endless scroll (where reaching the meetings meant scrolling past every
// task).
//
// The sections themselves are the very same panels the desktop renders — the
// difference is the navigation around them, not a second implementation of
// the tracker.

export type MobileTab = "today" | "tasks" | "meetings" | "ideas" | "calendar";

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: "today", label: "Сегодня", icon: "◎" },
  { id: "tasks", label: "Задачи", icon: "☑" },
  { id: "meetings", label: "Встречи", icon: "📅" },
  { id: "ideas", label: "Мысли", icon: "💡" },
  { id: "calendar", label: "Месяц", icon: "▦" },
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
              onClick={() => onTabChange(t.id)}
            >
              <span className="mobile-tab-icon">
                {t.icon}
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
