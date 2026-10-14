"use client";

import Icon, { type IconName } from "./Icon";
import { colorOf, initialsOf, PERSON_STATE_LABEL, shortName, type PersonState } from "@/lib/personBadge";
import { withoutSelfMark } from "@/lib/actorName";

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
  done: "finish",
  working: "check",
  declined: "ban",
  unreachable: "mailbox",
};

export default function PersonBadge({
  name,
  state,
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
  const icon = state ? STATE_ICON[state] : undefined;
  const full = withoutSelfMark(name);
  const title = [full, roleNote, state ? PERSON_STATE_LABEL[state] : ""].filter(Boolean).join(" — ");
  return (
    <span className={"pbadge" + (state ? " ps-" + state : "")} title={title}>
      <span className="pbadge-dot" style={{ background: colorOf(full) }} aria-hidden>
        {initialsOf(full)}
        {icon && (
          <span className="pbadge-state">
            <Icon name={icon} size={icon === "finish" ? 11 : 9} />
          </span>
        )}
      </span>
      {showName && <span className="pbadge-name">{short ? shortName(full) : full}</span>}
      {stateWord && state && <span className="pbadge-word">{PERSON_STATE_LABEL[state]}</span>}
    </span>
  );
}
