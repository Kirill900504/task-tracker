"use client";

import { useRef, useState } from "react";
import type { Section } from "@/types/tracker";

// Разделы кнопками под панелью задач: выбрать, завести новый, переставить.
//
// Перестановка сделана указателем, а не HTML5-перетаскиванием, и это не
// прихоть: drag-and-drop браузера на телефоне не существует вовсе (см.
// правило про касания в заметках), а разделы переставляют именно там, где
// их читают. Pointer-события одинаковы для мыши и пальца, поэтому «зажать и
// перетащить» работает и там, и там.
//
// Зажать — буквально: перетаскивание начинается через HOLD_MS удержания на
// месте. Без этой задержки строка разделов на телефоне перестала бы
// прокручиваться вбок: первое же движение пальцем считалось бы переносом.

const HOLD_MS = 250;
// Столько пикселей пальцу прощается за время удержания — рука дрожит,
// экран мелкий.
const HOLD_SLOP = 8;

export default function SectionTabs({
  sections,
  value,
  onSelect,
  onAdd,
  onReorder,
}: {
  sections: Section[];
  value: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  // Новый порядок целиком — идентификаторы разделов слева направо.
  onReorder: (ids: string[]) => void;
}) {
  // Порядок, который человек видит, пока держит палец: настоящий приезжает
  // из состояния приложения после отпускания.
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startAt = useRef<{ x: number; y: number } | null>(null);
  // Было ли перетаскивание: если было, нажатие не должно ещё и переключать
  // фильтр — человек переставлял, а не выбирал.
  const moved = useRef(false);

  // По sortOrder, а не в том порядке, в каком разделы лежат в массиве:
  // после перестановки состояние обновляется на месте (upsertById сохраняет
  // позицию), и без этой сортировки кнопки прыгнули бы обратно до
  // перезагрузки страницы.
  const sorted = [...sections].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const order = preview ?? sorted.map((s) => s.id);
  const byId = new Map(sorted.map((s) => [s.id, s]));

  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    startAt.current = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    // Только основная кнопка мыши и палец; правой кнопкой ничего не таскают.
    if (e.button !== 0) return;
    moved.current = false;
    startAt.current = { x: e.clientX, y: e.clientY };
    const target = e.currentTarget;
    holdTimer.current = setTimeout(() => {
      setDragId(id);
      setPreview(sorted.map((s) => s.id));
      // Дальнейшие события приходят сюда, даже если палец ушёл с кнопки.
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* браузер без захвата указателя — перетаскивание просто менее цепкое */
      }
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const from = startAt.current;
    if (!dragId) {
      // Ушли пальцем раньше, чем закончилось удержание, — это прокрутка.
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > HOLD_SLOP) cancelHold();
      return;
    }
    moved.current = true;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overId = (el as HTMLElement | null)?.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
    if (!overId || overId === dragId) return;
    setPreview((cur) => {
      const list = [...(cur ?? sorted.map((s) => s.id))];
      const from = list.indexOf(dragId);
      const to = list.indexOf(overId);
      if (from < 0 || to < 0) return cur;
      list.splice(to, 0, ...list.splice(from, 1));
      return list;
    });
  }

  function onPointerUp() {
    cancelHold();
    if (dragId && preview) {
      const before = sorted.map((s) => s.id).join();
      if (preview.join() !== before) onReorder(preview);
    }
    setDragId(null);
    setPreview(null);
  }

  return (
    <div className="section-tabs" id="sectionTabs">
      <button
        type="button"
        className={"section-tab" + (value === "all" ? " active" : "")}
        onClick={() => onSelect("all")}
      >
        Все
      </button>

      {order.map((id) => {
        const s = byId.get(id);
        if (!s) return null;
        return (
          <button
            key={s.id}
            type="button"
            data-section-id={s.id}
            className={
              "section-tab" +
              (s.kind === "personal" ? " personal" : "") +
              (value === s.id ? " active" : "") +
              (dragId === s.id ? " dragging" : "")
            }
            title={`${s.name} — зажмите, чтобы переставить`}
            onPointerDown={(e) => onPointerDown(e, s.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => {
              if (moved.current) return;
              onSelect(value === s.id ? "all" : s.id);
            }}
          >
            {s.name}
          </button>
        );
      })}

      <button type="button" className="section-tab section-tab-add" id="addSectionTabBtn" title="Новый раздел" onClick={onAdd}>
        +
      </button>
    </div>
  );
}
