"use client";

import { useId } from "react";
import Icon, { type IconName } from "./Icon";
import { colorOf, initialsOf, PERSON_STATE_LABEL, shortName, type PersonState } from "@/lib/personBadge";
import { withoutSelfMark } from "@/lib/actorName";
import { useArchivedPeople } from "@/hooks/useArchivedPeople";
import ArchivedMark from "./ArchivedMark";

// Человек на задаче: кружок с буквами, а в его углу — где он в работе.
//
// Одна форма на доску и на окно задачи (слова Кирилла 13.10.2026: «это всё
// по одной форме должно быть видно всем участникам процесса»). Значок
// состояния — тот же набор, что у фишек людей в карточке: флаг — закончил,
// галочка — взял в работу, перечёркнутый круг — не может, ящик — задача до
// него не дошла. «Ещё не приступал» значка не имеет: пустой угол и
// пунктирное кольцо говорят это тише всех, и так и должно быть — это
// состояние по умолчанию.
const STATE_ICON: Partial<Record<PersonState, IconName>> = {
  working: "check",
  declined: "ban",
  unreachable: "mailbox",
};

// «Закончил» — флаг финиша, как 🏁 (14.10.2026, его слова: «именно такой
// финишный флаг нельзя вставить тому, кто закончил задачу?»). Нарисован
// здесь, а не эмодзи: эмодзи рисует система — на Windows своей наклейкой, а
// на телефоне однажды пустым прямоугольником (осмотр 21.09.2026, см.
// TaskAnswer). Поэтому и цвета свои, не currentColor: это картинка флага, а
// не значок кнопки — чёрно-белые клетки на развевающемся полотнище и серое
// древко, без кружка-подложки, чтобы читался именно 🏁.
function FinishFlag() {
  const clip = useId();
  const cloth = "M6 3.2C9.5 1.6 12.5 4.6 16 3.2S20.5 2.4 22 3v9.6c-1.5-.6-2.5-.4-6 1S9.5 11.2 6 12.8Z";
  return (
    <svg className="finish-flag" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d={cloth} />
        </clipPath>
      </defs>
      <rect x="3.6" y="1.8" width="2" height="20.6" rx="1" fill="#B8C0C4" stroke="#1A2022" strokeWidth="0.8" />
      <path d={cloth} fill="#FFFFFF" />
      <g clipPath={`url(#${clip})`} fill="#15191B">
        <path d="M6 0h4v4H6zM14 0h4v4h-4zM10 4h4v4h-4zM18 4h4v4h-4zM6 8h4v4H6zM14 8h4v4h-4zM10 12h4v4h-4zM18 12h4v4h-4z" />
      </g>
      <path d={cloth} fill="none" stroke="#15191B" strokeWidth="0.9" strokeLinejoin="round" />
    </svg>
  );
}

export default function PersonBadge({
  name,
  state: stateIn,
  showName = false,
  short = true,
  roleNote,
  stateWord = false,
}: {
  name: string;
  // Без состояния — просто человек (постановщик, наблюдатель).
  state?: PersonState;
  // Имя рядом с кружком. На кубике его показывают, пока людей мало: два
  // имени читаются, шесть — уже нет, и тогда остаются кружки.
  showName?: boolean;
  short?: boolean;
  // «соисполнитель», «наблюдатель» — в подсказку.
  roleNote?: string;
  // Этап ещё и словом рядом с именем — в окне задачи, где место есть, а
  // значок в углу кружка мелкий для того, кто не знает, что он значит.
  stateWord?: boolean;
}) {
  const full = withoutSelfMark(name);
  // Убранный из команды остаётся на своей задаче — это история, — но
  // кружок гаснет и рядом с именем стоит «удалён» (useArchivedPeople). На
  // кубике, где имени нет, то же говорит подсказка. «Задача не дошла» у
  // него не пишется: мессенджеры снимаются вместе с уходом, и это не
  // поломка доставки, а «удалён», сказанное второй раз хуже.
  const archived = useArchivedPeople()(name);
  const state = archived && stateIn === "unreachable" ? undefined : stateIn;
  const icon = state ? STATE_ICON[state] : undefined;
  const title = [full, roleNote, state ? PERSON_STATE_LABEL[state] : "", archived ? "удалён из команды" : ""].filter(Boolean).join(" — ");
  return (
    <span className={"pbadge" + (state ? " ps-" + state : "") + (archived ? " ps-archived" : "")} title={title}>
      <span className="pbadge-dot" style={{ background: colorOf(full) }} aria-hidden>
        {initialsOf(full)}
        {state === "done" && (
          <span className="pbadge-state pbadge-finish">
            <FinishFlag />
          </span>
        )}
        {icon && (
          <span className="pbadge-state">
            <Icon name={icon} size={9} />
          </span>
        )}
      </span>
      {showName && <span className="pbadge-name">{short ? shortName(full) : full}</span>}
      {showName && archived && <ArchivedMark />}
      {stateWord && state && <span className="pbadge-word">{PERSON_STATE_LABEL[state]}</span>}
    </span>
  );
}
