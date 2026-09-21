"use client";

import { useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import Icon from "./Icon";
import { orderWithAt, slotAt, type SectionSnapshot } from "@/lib/sectionOrder";
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
  onNewTask,
  onSettings,
  canEdit = true,
}: {
  sections: Section[];
  value: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  // Новый порядок целиком — идентификаторы разделов слева направо.
  onReorder: (ids: string[]) => void;
  // Новая задача по разделу, с уже подставленными ответственными за него.
  //
  // Кнопки поменялись местами 20.09.2026 по его прямой просьбе: «в
  // разделах поменяй принцип нажатия: если левой кнопкой мыши — создаётся
  // задача, если правой — делается отбор». Днём раньше он просил ровно
  // наоборот, и это не противоречие, а счёт нажатий: отбор по разделу
  // сбрасывается сам собой, а задачу в разделе заводят десятки раз в день,
  // и она стоила двух шагов.
  //
  // Переименование и удаление переехали в окно «Разделы» (шестерёнка в
  // конце строки): обе кнопки мыши достались тому, что делают каждый день,
  // а не тому, что делают раз в квартал.
  onNewTask: (section: Section) => void;
  onSettings: () => void;
  // Разделы — структура трекера, и меняет её владелец. Руководитель их
  // видит и выбирает ими, но не заводит, не переименовывает, не удаляет и
  // не переставляет: его в этом откажет и база (миграция 0031), а кнопка,
  // ведущая к отказу, хуже отсутствующей.
  canEdit?: boolean;
}) {
  const isMobile = useIsMobile();
  // Порядок, который человек видит, пока держит палец: настоящий приезжает
  // из состояния приложения после отпускания.
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startAt = useRef<{ x: number; y: number } | null>(null);
  // Кнопка, на которой нажали, и чем нажали: пока перенос не начался, это
  // всё, что о нём известно.
  const armed = useRef<{ id: string; el: HTMLElement; touch: boolean } | null>(null);
  // Где какая кнопка стояла В МОМЕНТ НАЧАЛА переноса — снимок, по которому
  // считается позиция вставки, пока перенос идёт. См. длинный комментарий
  // у slotAt: без него перенос терял шаги.
  const slots = useRef<SectionSnapshot>({ slots: [], rowX: 0, rowY: 0 });
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
    // Снимок ряда — один раз, здесь. Дальше он не пересчитывается нарочно:
    // см. slotAt.
    const row = document.getElementById("sectionTabs")?.getBoundingClientRect();
    slots.current = {
      slots: [...document.querySelectorAll<HTMLElement>("#sectionTabs [data-section-id]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.sectionId!, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }),
      // Где стоял сам ряд: пока его ведут, страница может уехать — см.
      // SectionSnapshot.
      rowX: row?.left ?? 0,
      rowY: row?.top ?? 0,
    };
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
    // Куда встанет раздел, если отпустить здесь, — считается по снимку
    // ряда, а не по тому, что сейчас под указателем (см. lib/sectionOrder:
    // там записано, чем это отличается и что ломалось раньше).
    const row = document.getElementById("sectionTabs")?.getBoundingClientRect();
    const to = slotAt(slots.current, e.clientX, e.clientY, dragId, row?.left ?? 0, row?.top ?? 0);
    if (to < 0) return;
    const next = orderWithAt(
      slots.current.slots.map((s) => s.id),
      dragId,
      to,
    );
    setPreview((cur) => (cur && cur.join() === next.join() ? cur : next));
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
      {/* «Все» снимает отбор ОБЕИМИ кнопками мыши, и это не удобство, а
          выход из тупика: отбор ставится правой кнопкой, и рука, уже
          выбравшая раздел правой, снимает его тем же нажатием по «Все».
          Без обработчика правая кнопка здесь открывала меню браузера, и
          единственная кнопка, которая возвращает доску целиком, выглядела
          сломанной. Заводить тут нечего — раздела у «Все» нет, — поэтому
          оба нажатия делают одно и то же. */}
      <button
        type="button"
        className={"section-tab" + (value === "all" ? " active" : "")}
        title="Показать задачи всех разделов"
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect("all");
        }}
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
            title={
              isMobile
                ? `${s.name} — показать задачи раздела${canEdit ? "; зажмите, чтобы переставить" : ""}`
                : `${s.name} — новая задача в разделе; правая кнопка: показать только его задачи${canEdit ? "; зажмите, чтобы переставить" : ""}`
            }
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(value === s.id ? "all" : s.id);
            }}
            onPointerDown={(e) => canEdit && onPointerDown(e, s.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => {
              if (moved.current) return;
              // На телефоне правой кнопки нет, а долгое нажатие уже занято
              // перестановкой — поэтому там нажатие делает то, что делают
              // чаще: отбор. Новая задача заводится кнопкой «+ Новая
              // задача», где раздел выбирается в форме.
              if (isMobile) onSelect(value === s.id ? "all" : s.id);
              else onNewTask(s);
            }}
          >
            {s.name}
          </button>
        );
      })}

      {canEdit && (
        <>
          <button type="button" className="section-tab section-tab-add" id="addSectionTabBtn" title="Новый раздел" onClick={onAdd}>
            +
          </button>
          <button
            type="button"
            className="section-tab section-tab-add"
            id="sectionSettingsBtn"
            title="Разделы: названия, ответственные, удаление"
            onClick={onSettings}
          >
            <Icon name="users" size={14} />
          </button>
        </>
      )}

    </div>
  );
}
