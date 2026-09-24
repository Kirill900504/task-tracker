"use client";

import { useRef, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import Icon, { type IconName } from "./Icon";
import { SWIPE_PX_OVER_CARD, neighbour, startsInBusyArea, startsOverCard, verdict } from "@/lib/mobileSwipe";

// The phone gets its own frame: one section on screen at a time, chosen from
// a bar under the thumb, instead of the desktop's three columns stacked into
// one endless scroll (where reaching the meetings meant scrolling past every
// task).
//
// The sections themselves are the very same panels the desktop renders — the
// difference is the navigation around them, not a second implementation of
// the tracker.

export type MobileTab = "today" | "tasks" | "work" | "meetings" | "ideas" | "review";

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
// «В работе» встал между «Задачами» и «Приёмкой» 23.09.2026: три состояния
// доски были кнопками ВНУТРИ одного раздела «Задачи» («Новые задачи» / «В
// работе» / «На приёмке»), и Кирилл попросил прямо — «убрать кнопки… и
// сделать три полноценных раздела, по примеру ЗАДАЧИ и ПРИЁМКА, только
// добавить по середине раздел В РАБОТЕ». «Задачи» после этого значит
// «новые», «Приёмка» осталась тем же разделом, что и была.
//
// Значки — контурные из Icon.tsx, а не эмодзи. Эмодзи рисует система: на
// Windows это цветные наклейки своего размера и своего цвета, который не
// темнеет вместе с неактивной вкладкой, — пять разных картинок в ряд
// вместо одного набора (см. правило про шрифты и значки в CLAUDE.md).
const TABS: { id: MobileTab; label: string; icon: IconName }[] = [
  { id: "meetings", label: "Встречи", icon: "calendar" },
  { id: "tasks", label: "Задачи", icon: "tasks" },
  { id: "work", label: "В работе", icon: "clock" },
  { id: "review", label: "Приёмка", icon: "inbox" },
  { id: "ideas", label: "Мысли", icon: "bulb" },
  { id: "today", label: "Сегодня", icon: "today" },
];

const TAB_IDS = TABS.map((t) => t.id);

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
  // Листание разделов пальцем.
  //
  // Правило, по которому жест отличается от всех остальных горизонталей на
  // этом экране, вынесено в lib/mobileSwipe — там же записано, почему оно
  // именно такое. Здесь остаются только руки: где палец лёг и куда пришёл.
  const from = useRef<{ x: number; y: number } | null>(null);
  // Жест начался на карточке задачи — ей отдаётся первые 150px (см.
  // lib/mobileSwipe), и только после них движение читается как смена
  // раздела, а не как её собственный свайп.
  const overCard = useRef(false);

  // Касания, а не pointer-события — и это вся починка 24.09.2026, третьей
  // по счёту попытки. На настоящем телефоне браузер, увидев, что палец
  // поехал, забирает касание себе под прокрутку и вместо pointerup шлёт
  // pointercancel. Старт обнулялся, и жест не срабатывал НИКОГДА — даже на
  // пустом разделе, где карточек нет вовсе (снимки Кирилла с iPhone). В
  // e2e это не видно: синтетическое событие до браузерной прокрутки не
  // доходит. touchend прокрутка не отменяет, он приходит всегда.
  function onTouchStart(e: ReactTouchEvent) {
    if (e.touches.length !== 1) {
      from.current = null;
      return;
    }
    if (startsInBusyArea(e.target as Element)) return;
    const t = e.touches[0];
    overCard.current = startsOverCard(e.target as Element);
    from.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: ReactTouchEvent) {
    const start = from.current;
    from.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const where = verdict(t.clientX - start.x, t.clientY - start.y, overCard.current ? SWIPE_PX_OVER_CARD : undefined);
    const next = neighbour(TAB_IDS, tab, where);
    if (next) onTabChange(next);
  }

  return (
    <>
      <main
        className="mobile-main"
        id="mobileMain"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          from.current = null;
        }}
      >
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
        {/* Поиск вернулся в меню шапки 23.09.2026 — сюда он переехал
            22.09.2026 шестой кнопкой, но с добавлением «В работе» разделов
            в этой полосе и так стало шесть, и седьмая, единственная не
            переключающая раздел, начала путать ряд. */}
      </nav>
    </>
  );
}
