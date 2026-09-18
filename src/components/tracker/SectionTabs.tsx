"use client";

import { useRef, useState } from "react";
import ActionMenu from "./ActionMenu";
import type { Section } from "@/types/tracker";

// Разделы кнопками под панелью задач: выбрать, завести новый, переставить.
//
// Перестановка сделана указателем, а не HTML5-перетаскиванием, и это не
// прихоть: drag-and-drop браузера на телефоне не существует вовсе (см.
// правило про касания в заметках), а разделы переставляют именно там, где
// их читают. Pointer-события одинаковы для мыши и пальца, поэтому «зажать и
// перетащить» работает и там, и там.
//
// Мышь и палец начинают перенос по-разному, и это не придирка: первая
// версия требовала подержать кнопку неподвижно четверть секунды — и мышью
// не работала вовсе, потому что мышью «зажал и потянул» означает потянул
// сразу же. Теперь мышь начинает перенос с первым же движением, а палец —
// по-прежнему после удержания: иначе строка разделов перестанет
// прокручиваться вбок, ведь первое движение пальцем — это прокрутка.

const HOLD_MS = 250;
// Столько пикселей пальцу прощается за время удержания — рука дрожит,
// экран мелкий.
const HOLD_SLOP = 8;
// А мышь считается «поехавшей» почти сразу: случайный сдвиг на пиксель при
// нажатии не должен превращаться в перенос, всё остальное — должно.
const MOUSE_SLOP = 4;

export default function SectionTabs({
  sections,
  value,
  onSelect,
  onAdd,
  onReorder,
  onRename,
  onDelete,
  canEdit = true,
}: {
  sections: Section[];
  value: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  // Новый порядок целиком — идентификаторы разделов слева направо.
  onReorder: (ids: string[]) => void;
  // Правая кнопка мыши по разделу: переименовать или удалить.
  onRename: (section: Section) => void;
  onDelete: (section: Section) => void;
  // Разделы — структура трекера, и меняет её владелец. Руководитель их
  // видит и выбирает ими, но не заводит, не переименовывает, не удаляет и
  // не переставляет: его в этом откажет и база (миграция 0031), а кнопка,
  // ведущая к отказу, хуже отсутствующей.
  canEdit?: boolean;
}) {
  // Порядок, который человек видит, пока держит палец: настоящий приезжает
  // из состояния приложения после отпускания.
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Меню по правой кнопке: у раздела ровно два действия, и оба редкие —
  // держать их кнопками в строке значило бы отдать им место постоянно.
  const [menuFor, setMenuFor] = useState<{ section: Section; anchor: DOMRect } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startAt = useRef<{ x: number; y: number } | null>(null);
  // Кнопка, на которой нажали, и чем нажали: пока перенос не начался, это
  // всё, что о нём известно.
  const armed = useRef<{ id: string; el: HTMLElement; touch: boolean } | null>(null);
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
    armed.current = null;
  }

  function beginDrag(id: string, target: HTMLElement | null, pointerId: number) {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setDragId(id);
    setPreview(sorted.map((s) => s.id));
    // Дальнейшие события приходят сюда, даже если указатель ушёл с кнопки.
    try {
      target?.setPointerCapture(pointerId);
    } catch {
      /* браузер без захвата указателя — перетаскивание просто менее цепкое */
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    // Только основная кнопка мыши и палец; правой кнопкой ничего не таскают.
    if (e.button !== 0) return;
    moved.current = false;
    startAt.current = { x: e.clientX, y: e.clientY };
    armed.current = { id, el: e.currentTarget, touch: e.pointerType !== "mouse" };
    if (e.pointerType === "mouse") return;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    holdTimer.current = setTimeout(() => beginDrag(id, target, pointerId), HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const from = startAt.current;
    if (!dragId) {
      const pending = armed.current;
      if (!pending || !from) return;
      const gone = Math.hypot(e.clientX - from.x, e.clientY - from.y);
      // Палец: ушёл раньше, чем закончилось удержание, — это прокрутка.
      // Мышь: ушла — значит тянут, и ждать нечего.
      if (pending.touch) {
        if (gone > HOLD_SLOP) cancelHold();
      } else if (gone > MOUSE_SLOP) {
        beginDrag(pending.id, pending.el, e.pointerId);
      }
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
            title={canEdit ? `${s.name} — зажмите, чтобы переставить; правая кнопка — переименовать или удалить` : s.name}
            onContextMenu={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setMenuFor({ section: s, anchor: e.currentTarget.getBoundingClientRect() });
            }}
            onPointerDown={(e) => canEdit && onPointerDown(e, s.id)}
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

      {canEdit && (
        <button type="button" className="section-tab section-tab-add" id="addSectionTabBtn" title="Новый раздел" onClick={onAdd}>
          +
        </button>
      )}

      {menuFor && (
        <ActionMenu
          anchor={menuFor.anchor}
          title={menuFor.section.name}
          items={[
            { id: "rename", label: "✎ Редактировать", onSelect: () => onRename(menuFor.section) },
            { id: "delete", label: "🗑 Удалить", onSelect: () => onDelete(menuFor.section) },
          ]}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}
