"use client";

import type { IdeaRecipientRow } from "@/lib/ideaRecipients";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import ReceivedIdeaActions from "./ReceivedIdeaActions";

// Мысль, которой со мной ПОДЕЛИЛИСЬ (миграция 0051).
//
// Решение Кирилла 23.09.2026: «поделиться» — мысль остаётся у автора и
// просто становится видна получателю, «ничего не подтверждается». Поэтому
// она лежит в общем списке мыслей, а не в блоке «Прислали вам», где ждут
// ответа: выглядит как своя, только с подписью, от кого, и без того, что
// с чужой записью делать нельзя (править, вычёркивать, отмечать «важно» —
// это строка автора, и база откажет молча).
//
// Ответы те же четыре, что у присланной (22.10.2026, его слова: «варианты
// действий такие же, как и в отправленной»): «В работу», «Встреча»,
// «Сохранить в мысли» и «👌» — убрать у себя. У автора мысль остаётся при
// любом из них.
export default function SharedIdeaItem({
  row,
  from,
  onAnswered,
  onKeep,
  onToTask,
  onToMeeting,
}: {
  row: IdeaRecipientRow;
  // Кто поделился — именем.
  from: string;
  onAnswered: (row: IdeaRecipientRow, answer: "taken" | "seen" | "failed") => void;
  onKeep: (row: IdeaRecipientRow) => void;
  onToTask: (row: IdeaRecipientRow) => void;
  onToMeeting: (row: IdeaRecipientRow) => void;
}) {
  return (
    <div className="idea-item idea-shared" data-shared-idea={row.ideaId}>
      <div className="idea-shared-body">
        <div className="idea-text">{row.idea?.text}</div>
        <div className="idea-meta">
          от {from} · {formatIdeaCreatedAt(row.createdAt)}
        </div>
        <ReceivedIdeaActions row={row} onAnswered={onAnswered} onKeep={onKeep} onToTask={onToTask} onToMeeting={onToMeeting} />
      </div>
    </div>
  );
}
