"use client";

import { useState } from "react";
import type { Participant } from "@/hooks/useTaskParticipants";
import { fmtDate } from "@/lib/taskDisplay";
import AnswerForm from "./AnswerForm";
import Icon from "./Icon";

// Что от ВАС ждут по этой задаче — внутри самой задачи.
//
// Раньше это был отдельный экран над трекером («Что от вас ждут»), и
// Кирилл сказал о нём прямо 19.09.2026: «этот первичный функционал думаю
// вообще убрать, он глупо построен и не продуман… супер не удобный для
// использования, мне подключённые Козлов и Витовский сразу пожаловались…
// у всех пользователей окно должно сразу быть как у меня».
//
// Он прав, и причина глубже неудобства: экран был ВТОРЫМ местом, где живёт
// задача. Человек видел одну и ту же работу дважды — списком наверху и
// карточкой в столбце, — а ответить мог только в одном из них. Теперь
// ответ стоит там же, где задача: открыл карточку — и всё, что можно
// сделать, перед тобой.
//
// Кто что видит:
//   исполнитель            — кнопки ответа, пока не отчитался;
//   соисполнитель, наблюдатель — ничего, и это не забывчивость: держат
//                            задачу открытой только исполнители (см.
//                            taskProgress), а кнопка, после которой база
//                            откажет, обманывает молча;
//   постановщик            — приёмку, но она живёт в TaskParticipants.

type Pending = "done" | "decline" | "move" | null;

export default function TaskAnswer({
  me,
  closed,
  deadline,
  returnedComment,
  onAccept,
  onReport,
  onDecline,
  onAskReschedule,
  onReported,
}: {
  // Моя строка участия в этой задаче. Пусто — меня на ней нет.
  me: Participant | null;
  // Задача закрыта: работу приняли или закрыли принудительно. Отвечать
  // больше не по чему, и кнопка «Сделал» на закрытой задаче — это
  // предложение сделать то, о чём уже договорились.
  closed?: boolean;
  deadline: string;
  // Комментарий постановщика, если задачу вернули на доработку: это первое,
  // что человек должен прочитать, открыв её снова.
  returnedComment?: string;
  onAccept: () => Promise<void>;
  onReport: (comment: string) => Promise<void>;
  onDecline: (reason: string) => Promise<void>;
  onAskReschedule: (to: string, reason: string) => Promise<void>;
  // Отчёт ушёл — карточку можно закрывать.
  //
  // Слова Кирилла 21.09.2026: «если человек пишет в каком-то событии
  // итоговый результат, то после нажатия должны закрываться сразу все
  // уровни задачи или встречи». Отчёт — это и есть итоговый результат
  // исполнителя: после него задача уезжает на приёмку и ждёт уже не его.
  // Окно, остающееся висеть над отправленным отчётом, читается как «а
  // что, не сработало?».
  //
  // Зовётся ТОЛЬКО после успешного «Сделал»: не ушло — окно остаётся, и
  // причина видна в нём же. «Не могу» и «Прошу перенос» окно не
  // закрывают: там человек ещё читает, что ответит постановщик.
  onReported?: () => void;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  if (!me || me.role !== "executor") return null;
  if (closed && !me.doneAt && !me.declinedAt) return null;

  // Ответ может не уйти — сеть или отказ сервера. Промолчать здесь значит
  // оставить человека в уверенности, что он отчитался, а постановщика — в
  // уверенности, что тот молчит. Худшее недоразумение в этом трекере.
  async function run(action: () => Promise<void>, thenClose = false) {
    setBusy(true);
    setFailed("");
    try {
      await action();
      setPending(null);
      if (thenClose) onReported?.();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Не получилось отправить ответ");
    } finally {
      setBusy(false);
    }
  }

  const reported = !!me.doneAt;
  const declined = !!me.declinedAt && !me.doneAt;

  return (
    <div className="my-work">
      <div className="my-work-head">
        <Icon name="check" size={14} /> Это поручено вам
      </div>

      {returnedComment && (
        <div className="my-work-returned">
          ↩ Вернули на доработку: {returnedComment}
        </div>
      )}

      {reported && (
        <div className="my-work-said">
          Ваш отчёт: {me.doneComment || "без комментария"}
        </div>
      )}

      {declined && (
        <div className="my-work-said declined">
          Вы отказались: {me.declineReason || "без причины"}
        </div>
      )}

      {me.rescheduleTo && (
        <div className="my-work-said">
          Вы просите перенести {me.rescheduleTo ? "на " + fmtDate(me.rescheduleTo) : "срок"}
          {me.rescheduleReason ? `: ${me.rescheduleReason}` : ""} — ждём ответа постановщика.
        </div>
      )}

      {!reported && me.acceptedAt && !declined && <div className="my-work-said">Вы приняли в работу.</div>}

      {failed && <div className="ms-answer-error">{failed}</div>}

      {pending === "done" && (
        <AnswerForm
          id="myWorkDone"
          question="Что именно сделано?"
          placeholder="Коротко: что готово и где смотреть"
          emptyHint="Отчёт без слов — это не отчёт: постановщику нечего принимать."
          submitLabel="Отправить отчёт"
          busy={busy}
          onSubmit={(text) => void run(() => onReport(text), true)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "decline" && (
        <AnswerForm
          id="myWorkDecline"
          question="Почему не получается?"
          placeholder="Что мешает"
          emptyHint="Отказ без причины — это молчание с нажатой кнопкой."
          submitLabel="Отправить"
          busy={busy}
          onSubmit={(text) => void run(() => onDecline(text))}
          onCancel={() => setPending(null)}
        />
      )}

      {pending === "move" && (
        <AnswerForm
          id="myWorkMove"
          question="До какого числа нужно и почему?"
          placeholder="Причина переноса"
          emptyHint="Причина обязательна: по ней постановщик и решает."
          submitLabel="Попросить перенос"
          date={{ label: "Новый срок", initial: deadline || "" }}
          busy={busy}
          onSubmit={(text, when) => void run(() => onAskReschedule(when, text))}
          onCancel={() => setPending(null)}
        />
      )}

      {!pending && !reported && !closed && (
        <div className="ms-actions">
          {!me.acceptedAt && !declined && (
            <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void run(onAccept)}>
              <Icon name="check" size={14} /> Принял
            </button>
          )}
          {/* Флажка 🏁 здесь больше нет: соседние три кнопки нарисованы
              контуром из Icon.tsx, а этот рисовала система — и на телефоне
              рисовала пустым прямоугольником, то есть главная кнопка
              исполнителя выглядела сломанной. Осмотр 21.09.2026. */}
          <button type="button" className="btn btn-small btn-primary" onClick={() => setPending("done")}>
            <Icon name="flag" size={14} /> Сделал
          </button>
          {!declined && (
            <button type="button" className="btn btn-small" onClick={() => setPending("decline")}>
              <Icon name="ban" size={14} /> Не могу
            </button>
          )}
          {!me.rescheduleTo && (
            <button type="button" className="btn btn-small" onClick={() => setPending("move")}>
              <Icon name="calendar" size={14} /> Прошу перенос
            </button>
          )}
        </div>
      )}
    </div>
  );
}
