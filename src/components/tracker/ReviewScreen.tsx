"use client";

import type { Task } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";

// Очередь приёмки — отдельным экраном.
//
// «Ждут вашей приёмки» — единственное в трекере, что ждёт лично Кирилла:
// всё остальное ждёт кого-то из четырнадцати. На компьютере эта очередь
// стоит первым столбцом в задачах и видна сразу; на телефоне она лежала
// внутри вкладки «Задачи», над двумя другими столбцами, и до неё надо было
// добраться прокруткой — при том что пятая вкладка была занята календарём
// месяца, который с телефона открывают раз в неделю.
//
// Считается по колонке самой задачи, а не по строкам участия: её ставит
// маршрут в ту же секунду, когда отчитался последний исполнитель
// (closeIfEveryoneReported), и та же колонка кормит утреннюю сводку. Второй
// способ посчитать то же самое разошёлся бы с первым — это в проекте уже
// проходили трижды.

export function awaitingReview(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status !== "done" && t.approvalState === "awaiting_review");
}

export default function ReviewScreen({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const list = awaitingReview(tasks);

  if (!list.length) {
    return (
      <div className="ms-empty">
        Ничего не ждёт приёмки. Как только исполнители отчитаются по задаче, она появится здесь.
      </div>
    );
  }

  return (
    <div className="review-screen">
      <div className="section-title">
        Ждут вашей приёмки <span className="count">{list.length}</span>
      </div>
      {list.map((t) => (
        <button key={t.id} type="button" className="review-row" onClick={() => onOpen(t)}>
          <span className="review-row-title">{t.title}</span>
          <span className="review-row-meta">
            {t.assignee && <span className="pill">{t.assignee}</span>}
            {t.deadline && <span className="pill pill-date">до {fmtDate(t.deadline)}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
