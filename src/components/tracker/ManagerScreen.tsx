"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAssignedWork, type AssignedIdea, type AssignedMeeting, type AssignedTask } from "@/hooks/useAssignedWork";
import { fmtDate } from "@/lib/taskDisplay";
import { canDecline, canReportDone } from "@/lib/taskProgress";
import { canVoteNo, isCurrent } from "@/lib/meetingVotes";
import { byDeadline, canAnswer, isOverdueFor, workGroup } from "@/lib/assignedWork";
import { personStats } from "@/lib/peopleReview";

// Что видит руководитель, когда войдёт по приглашению.
//
// Not the owner's tracker with parts hidden. He is not running a company's
// worth of work here — he is answering for the few things addressed to him,
// and everything else on that screen would be noise he has to look past.
// Three groups, in the order he cares about them, and on every card the
// three answers he is allowed to give.
//
// Editing the task itself is absent on purpose rather than disabled: the
// database refuses it anyway (being on a task grants no right to change its
// deadline — B6), and an interface offering something that will be refused
// is worse than one that never offered it.

export default function ManagerScreen({ assigneeId, name, ownerId }: { assigneeId: string; name: string; ownerId: string }) {
  const { tasks, meetings, ideas, loading, accept, report, decline, askReschedule, vote, takeIdea } = useAssignedWork(assigneeId);
  return (
    <ManagerScreenInner
      name={name}
      tasks={tasks}
      meetings={meetings}
      ideas={ideas}
      loading={loading}
      accept={accept}
      report={report}
      decline={decline}
      askReschedule={askReschedule}
      vote={vote}
      takeIdea={(recipientId, ideaId, text) => void takeIdea(recipientId, ideaId, text, ownerId)}
    />
  );
}

// Разделено ради тестов: вся логика группировки и все правила «что можно
// нажать» живут в этой половине и проверяются без базы вообще.
export function ManagerScreenInner({
  name,
  tasks,
  meetings = [],
  ideas = [],
  loading,
  accept,
  report,
  decline,
  askReschedule,
  vote,
  takeIdea,
}: {
  name: string;
  tasks: AssignedTask[];
  meetings?: AssignedMeeting[];
  ideas?: AssignedIdea[];
  loading: boolean;
  accept: (participantId: string) => void | Promise<void>;
  report: (participantId: string, comment: string) => void | Promise<void>;
  decline: (participantId: string, reason: string) => void | Promise<void>;
  askReschedule: (participantId: string, to: string, reason: string) => void | Promise<void>;
  // Раунд не передаётся: его знает сервер, и он же единственный, кто
  // может знать его наверняка в момент нажатия.
  vote?: (participantId: string, response: "yes" | "no", reason: string) => void | Promise<void>;
  takeIdea?: (recipientId: string, ideaId: string, text: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState("");

  // Ответ может не уйти — сеть, или сервер отказал (комментарий пустой,
  // строка не твоя). Промолчать здесь значит оставить человека в
  // уверенности, что он отчитался, а постановщика — в уверенности, что он
  // молчит. Худшее из возможных недоразумений в этом трекере.
  async function run(action: () => void | Promise<void>) {
    setFailed("");
    try {
      await action();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Не получилось отправить ответ");
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const groups = useMemo(() => {
    const out: Record<"new" | "work" | "done", AssignedTask[]> = { new: [], work: [], done: [] };
    for (const t of tasks) out[workGroup(t)].push(t);
    out.new.sort(byDeadline);
    out.work.sort(byDeadline);
    return out;
  }, [tasks]);

  function handleReport(t: AssignedTask) {
    const comment = prompt(`Что сделано по задаче «${t.title}»? Это увидит постановщик:`, "");
    if (comment === null) return;
    if (!canReportDone(comment)) {
      alert("Отчёт без слов — не отчёт. Напишите хотя бы коротко, что сделано.");
      return;
    }
    void run(() => report(t.participantId, comment.trim()));
  }

  function handleDecline(t: AssignedTask) {
    const reason = prompt(`Почему не получится выполнить «${t.title}»?`, "");
    if (reason === null) return;
    if (!canDecline(reason)) {
      alert("Причина обязательна — именно она даёт постановщику шанс что-то поправить.");
      return;
    }
    void run(() => decline(t.participantId, reason.trim()));
  }

  function handleReschedule(t: AssignedTask) {
    const to = prompt("На какую дату перенести? В формате ГГГГ-ММ-ДД (можно оставить пустым):", t.deadline || "");
    if (to === null) return;
    const reason = prompt("Почему нужен перенос?", "");
    if (reason === null) return;
    if (!reason.trim()) {
      alert("Без причины это не просьба, а просто новая дата — напишите, что мешает.");
      return;
    }
    void run(() => askReschedule(t.participantId, to.trim(), reason.trim()));
  }

  const today = new Date().toISOString().slice(0, 10);

  // Считается той же функцией, что и понедельничная сводка владельца:
  // одна арифметика на двоих — единственный способ, чтобы цифры сошлись.
  const stats = useMemo(() => {
    if (!tasks.length) return null;
    const [only] = personStats(
      tasks.map((t) => ({
        name: name || "я",
        direction: "",
        createdAt: t.acceptedAt || t.doneAt || new Date().toISOString(),
        acceptedAt: t.acceptedAt,
        doneAt: t.doneAt,
        declinedAt: t.declinedAt,
        deadline: t.deadline,
        status: t.status,
      })),
      new Date(),
    );
    return only || null;
  }, [tasks, name]);

  function card(t: AssignedTask) {
    const overdue = isOverdueFor(t, today);
    return (
      <div className={"ms-card" + (overdue ? " overdue" : "") + (t.priority === "high" ? " high" : "")} key={t.participantId}>
        <div className="ms-card-title">{t.title}</div>
        {t.description && <div className="ms-card-desc">{t.description}</div>}

        <div className="ms-card-meta">
          {t.deadline && <span className={"pill pill-date" + (overdue ? " overdue-text" : "")}>{(overdue ? "⚠ просрочено: " : "до ") + fmtDate(t.deadline)}</span>}
          {t.priority === "high" && <span className="pill pill-high">важно</span>}
          {t.role !== "executor" && <span className="pill">{t.role === "coexecutor" ? "соисполнитель" : "наблюдатель"}</span>}
        </div>

        {t.approvalState === "returned" && t.approvalComment && (
          <div className="ms-returned">Вернули на доработку: {t.approvalComment}</div>
        )}
        {t.doneAt && t.doneComment && <div className="ms-reported">Ваш отчёт: {t.doneComment}</div>}
        {t.declinedAt && t.declineReason && <div className="ms-declined">Вы отказались: {t.declineReason}</div>}
        {t.rescheduleTo && <div className="ms-asked">Просили перенос на {fmtDate(t.rescheduleTo)}: {t.rescheduleReason}</div>}

        {/* Наблюдателя и соисполнителя не спрашивают — они и не должны
            видеть кнопок, которые ничего не значат для их роли. */}
        {canAnswer(t) && (
          <div className="ms-actions">
            {!t.acceptedAt && (
              <button className="btn btn-small btn-primary" type="button" onClick={() => void run(() => accept(t.participantId))}>
                ✅ Принял
              </button>
            )}
            <button className="btn btn-small" type="button" onClick={() => handleReport(t)}>
              🏁 Сделал
            </button>
            <button className="btn btn-small" type="button" onClick={() => handleDecline(t)}>
              ⛔ Не могу
            </button>
            <button className="btn btn-small" type="button" onClick={() => handleReschedule(t)}>
              📅 Прошу перенос
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ms">
      <div className="ms-head">
        <div>
          <h1 className="ms-title">{name || "Ваши задачи"}</h1>
          <div className="ms-sub">То, что адресовано вам. Отвечать можно здесь или в мессенджере — это одно и то же.</div>
        </div>
        {/* Свой выход, а не общий: слой данных владельца для руководителя
            не запускается вовсе, и его signOut здесь просто некому
            выполнить. */}
        <button className="btn btn-small ms-exit" type="button" onClick={() => void signOut()}>
          Выйти
        </button>
      </div>

      {/* G4: своя цифра меняет поведение дешевле любого разговора — и та
          же самая, что владелец видит в понедельник. Показывать человеку
          одно, а начальнику про него другое было бы началом недоверия. */}
      {!loading && stats && (
        <div className="ms-stats">
          <span className="ms-stat">
            <b>{stats.open}</b> в работе
          </span>
          {stats.overdue > 0 && (
            <span className="ms-stat ms-stat-bad">
              <b>{stats.overdue}</b> просрочено
            </span>
          )}
          {stats.doneThisWeek > 0 && (
            <span className="ms-stat">
              <b>{stats.doneThisWeek}</b> закрыто за неделю
            </span>
          )}
          {stats.onTimeShare !== null && (
            <span className="ms-stat">
              в срок <b>{Math.round(stats.onTimeShare * 100)}%</b>
            </span>
          )}
        </div>
      )}

      {failed && <div className="auth-error">{failed}</div>}

      {loading && <div className="empty">Загрузка…</div>}

      {!loading && tasks.length === 0 && meetings.length === 0 && ideas.length === 0 && (
        <div className="ms-empty">
          Пока ничего не назначено. Когда появится задача — она будет здесь, и придёт в мессенджер, если он подключён.
        </div>
      )}

      {/* Мысли — то, что прислали без обязательства. Единственное действие
          здесь и есть всё, что с мыслью можно сделать: взять в работу,
          после чего она перестанет быть мыслью и уйдёт наверх, к задачам. */}
      {!loading && ideas.length > 0 && takeIdea && (
        <section className="ms-group">
          <div className="section-title">
            Мысли от Кирилла <span className="count">{ideas.length}</span>
          </div>
          {ideas.map((i) => (
            <div className="ms-card ms-idea" key={i.recipientId}>
              <div className="ms-card-desc" style={{ marginTop: 0 }}>{i.text}</div>
              <div className="ms-actions">
                <button className="btn btn-small btn-primary" type="button" onClick={() => void run(() => takeIdea(i.recipientId, i.ideaId, i.text))}>
                  ➕ Взять в работу
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && meetings.length > 0 && (
        <section className="ms-group">
          <div className="section-title">
            Встречи <span className="count">{meetings.length}</span>
          </div>
          {meetings.map((m) => {
            // Ответ из прежнего круга не считается: время переносили, и о
            // новом этого человека ещё не спрашивали.
            const answered = isCurrent({ ...m, assigneeId: "", name: "", role: "participant" }, m.meetingRound) && m.response !== "none";
            return (
              <div className="ms-card" key={m.participantId}>
                <div className="ms-card-title">{m.title}</div>
                <div className="ms-card-meta">
                  <span className="pill pill-date">
                    {m.date.split("-").reverse().join(".")}
                    {m.time ? ", " + m.time : ""}
                  </span>
                  {answered && m.response === "yes" && <span className="pill pill-accepted">✅ вы будете</span>}
                  {answered && m.response === "no" && <span className="pill pill-blocked">❌ не сможете</span>}
                </div>
                {answered && m.response === "no" && m.reason && <div className="ms-declined">Причина: {m.reason}</div>}
                {!answered && vote && (
                  <div className="ms-actions">
                    <button className="btn btn-small btn-primary" type="button" onClick={() => void run(() => vote(m.participantId, "yes", ""))}>
                      ✅ Буду
                    </button>
                    <button
                      className="btn btn-small"
                      type="button"
                      onClick={() => {
                        const reason = prompt(`Почему не сможете быть на «${m.title}»?`, "");
                        if (reason === null) return;
                        if (!canVoteNo(reason)) {
                          alert("Причина обязательна: организатору важно знать, переносить встречу или нет.");
                          return;
                        }
                        void run(() => vote(m.participantId, "no", reason.trim()));
                      }}
                    >
                      ❌ Не смогу
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {!loading && groups.new.length > 0 && (
        <section className="ms-group">
          <div className="section-title">
            Новые <span className="count">{groups.new.length}</span>
          </div>
          {groups.new.map(card)}
        </section>
      )}

      {!loading && groups.work.length > 0 && (
        <section className="ms-group">
          <div className="section-title">
            В работе <span className="count">{groups.work.length}</span>
          </div>
          {groups.work.map(card)}
        </section>
      )}

      {!loading && groups.done.length > 0 && (
        <section className="ms-group">
          <div className="section-title">
            Сделано <span className="count">{groups.done.length}</span>
          </div>
          {groups.done.map(card)}
        </section>
      )}
    </div>
  );
}
