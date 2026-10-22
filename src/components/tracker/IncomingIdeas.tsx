"use client";

import type { IdeaRecipientRow } from "@/lib/ideaRecipients";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import Icon from "./Icon";
import ReceivedIdeaActions from "./ReceivedIdeaActions";

// «Прислали вам» — приёмка чужих мыслей в самом трекере.
//
// До 07.10.2026 присланная мысль существовала для получателя только в
// мессенджере: панель мыслей показывает свои (NewTracker, `myIdeas`), и
// кнопка «Взять в работу» жила одна, под сообщением бота. Кирилл: «у
// получателя, помимо приёмки чужих мыслей в мессенджерах, должна так же
// быть какой-то формат приёмки в приложении на ПК и мобильной версии».
//
// Устроено как короткая очередь над своими мыслями: каждая присланная —
// кто, когда, что, и четыре ответа — те же, что под мыслью в мессенджере
// (08.10.2026), маленькими кнопками своей мысли (ReceivedIdeaActions,
// 22.10.2026). «В работу» и «Встреча» открывают обычные формы;
// «Сохранить в мысли» кладёт копию в мои мысли с сегодняшней датой, и она
// встаёт в общий порядок как только что записанная (его же решение
// 23.09.2026 — «получить и сохранить», см. docs/next-ten.md, п. 12);
// «👌» — прочитал, у себя не храню. После любого ответа мысль уходит из
// блока, а автор видит ответ в списке «кому отправлена» у своей мысли.
// Блока нет вовсе, пока отвечать не на что: пустой заголовок над списком —
// та самая надпись, которая называет очевидное.
export default function IncomingIdeas({
  rows,
  authorOf,
  onAnswered,
  onKeep,
  onToTask,
  onToMeeting,
}: {
  rows: IdeaRecipientRow[];
  // Имя того, кто прислал (authorLabel: пустой created_by — владелец).
  authorOf: (createdBy: string | null) => string;
  onAnswered: (row: IdeaRecipientRow, answer: "taken" | "seen" | "failed") => void;
  onKeep: (row: IdeaRecipientRow) => void;
  // Так же, как в мессенджере (lib/ideaInbox), задачу можно поручить и
  // себе, и коллеге — слова Кирилла 08.10.2026: «взять в работу — то есть
  // создать на себя или коллегу конкретную задачу, назначить встречу —
  // создать на основании мысли встречу».
  onToTask: (row: IdeaRecipientRow) => void;
  onToMeeting: (row: IdeaRecipientRow) => void;
}) {
  if (!rows.length) return null;

  return (
    <div className="incoming-ideas" id="incomingIdeas">
      <div className="incoming-ideas-head">
        <Icon name="inbox" size={14} /> Прислали вам <span className="count">{rows.length}</span>
      </div>
      {rows.map((row) => (
        <div className="incoming-idea" key={row.id} data-incoming-idea={row.ideaId}>
          <div className="incoming-idea-text">{row.idea?.text}</div>
          <div className="incoming-idea-meta">
            от {authorOf(row.idea?.createdBy ?? null)} · {formatIdeaCreatedAt(row.createdAt)}
          </div>
          <ReceivedIdeaActions row={row} onAnswered={onAnswered} onKeep={onKeep} onToTask={onToTask} onToMeeting={onToMeeting} />
        </div>
      ))}
    </div>
  );
}
