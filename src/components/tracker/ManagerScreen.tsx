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
import { useMyMessenger, type MessengerState } from "@/hooks/useMyMessenger";
import MessengerLink from "@/components/tracker/MessengerLink";
import ManagerAnswer from "@/components/tracker/ManagerAnswer";
import ItemChat from "@/components/tracker/ItemChat";
import Icon from "./Icon";

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

export default function ManagerScreen({ assigneeId, name, embedded }: { assigneeId: string; name: string; embedded?: boolean }) {
  const { tasks, meetings, ideas, loading, accept, report, decline, askReschedule, vote, takeIdea } = useAssignedWork(assigneeId);
  const messenger = useMyMessenger(assigneeId);
  return (
    <ManagerScreenInner
      embedded={embedded}
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
      takeIdea={(recipientId) => void takeIdea(recipientId)}
      messenger={messenger}
    />
  );
}

// Разделено ради тестов: вся логика группировки и все правила «что можно
// нажать» живут в этой половине и проверяются без базы вообще.
export function ManagerScreenInner({
  embedded,
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
  messenger,
}: {
  // Внутри трекера, а не вместо него: у руководителя теперь полноценный
  // трекер, и это — его раздел «что от меня ждут». Тогда лишними
  // становятся заголовок с именем и «Выйти»: и то и другое уже есть в
  // шапке трекера, а второй выход рядом с первым — это вопрос, какой из
  // них настоящий.
  embedded?: boolean;
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
  vote?: (participantId: string, response: "yes" | "no" | "late", reason: string) => void | Promise<void>;
  takeIdea?: (recipientId: string) => void | Promise<void>;
  // Необязателен: половина с логикой проверяется без базы, а подключение
  // мессенджера — это как раз база и сеть.
  messenger?: MessengerState;
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

  // Какой ответ сейчас пишут и по какой строке. Одна форма на экран: две
  // открытые сразу — это два недописанных ответа и вопрос, который из них
  // уйдёт.
  const [asking, setAsking] = useState<{ kind: "done" | "decline" | "reschedule" | "vote"; id: string } | null>(null);
  const [sending, setSending] = useState(false);
  // Какое обсуждение раскрыто. Одно: два открытых — это две ленты, между
  // которыми надо листать, на экране, который и так листают с телефона.
  const [chatFor, setChatFor] = useState<string | null>(null);

  // Форма закрывается только после того, как ответ ушёл. Закрыть её раньше
  // значит потерять написанное ровно тогда, когда оно понадобится снова, —
  // при отказе сервера.
  async function send(action: () => void | Promise<void>) {
    setSending(true);
    setFailed("");
    try {
      await action();
      setAsking(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Не получилось отправить ответ");
    } finally {
      setSending(false);
    }
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
        {canAnswer(t) && asking?.id !== t.participantId && (
          <div className="ms-actions">
            {!t.acceptedAt && (
              <button className="btn btn-small btn-primary" type="button" onClick={() => void run(() => accept(t.participantId))}>
                <Icon name="check" size={15} /> Принял
              </button>
            )}
            <button className="btn btn-small" type="button" onClick={() => setAsking({ kind: "done", id: t.participantId })}>
              <Icon name="flag" size={15} /> Сделал
            </button>
            <button className="btn btn-small" type="button" onClick={() => setAsking({ kind: "decline", id: t.participantId })}>
              <Icon name="ban" size={15} /> Не могу
            </button>
            <button className="btn btn-small" type="button" onClick={() => setAsking({ kind: "reschedule", id: t.participantId })}>
              <Icon name="calendar" size={15} /> Прошу перенос
            </button>
          </div>
        )}

        {asking?.id === t.participantId && asking.kind === "done" && (
          <ManagerAnswer
            id={"done-" + t.participantId}
            question={`Что сделано по задаче «${t.title}»? Это увидит постановщик.`}
            placeholder="Например: свёл цифры за август, таблица в общей папке"
            emptyHint="Отчёт без слов — не отчёт. Напишите хотя бы коротко, что сделано."
            submitLabel="Отчитаться"
            busy={sending}
            onCancel={() => setAsking(null)}
            onSubmit={(text) => {
              if (!canReportDone(text)) return;
              void send(() => report(t.participantId, text));
            }}
          />
        )}
        {asking?.id === t.participantId && asking.kind === "decline" && (
          <ManagerAnswer
            id={"decline-" + t.participantId}
            question={`Почему не получится выполнить «${t.title}»?`}
            emptyHint="Причина обязательна — именно она даёт постановщику шанс что-то поправить."
            submitLabel="Отправить"
            busy={sending}
            onCancel={() => setAsking(null)}
            onSubmit={(text) => {
              if (!canDecline(text)) return;
              void send(() => decline(t.participantId, text));
            }}
          />
        )}
        {/* Обсуждение. По решениям проекта оно живёт внутри задачи и его
            видят все участники — но на этом экране его не было вовсе, и
            руководителю оставался мессенджер, где ответ попадал в «последнюю
            открытую задачу». Свёрнуто по умолчанию: экран для того, чтобы
            ответить, а не читать. */}
        <button
          className="btn btn-small ms-chat-toggle"
          type="button"
          onClick={() => setChatFor((cur) => (cur === t.taskId ? null : t.taskId))}
        >
          {chatFor === t.taskId ? "Свернуть обсуждение" : "💬 Обсуждение"}
        </button>
        {chatFor === t.taskId && <ItemChat kind="task" itemId={t.taskId} />}

        {asking?.id === t.participantId && asking.kind === "reschedule" && (
          <ManagerAnswer
            id={"move-" + t.participantId}
            question="Что мешает успеть к сроку?"
            emptyHint="Без причины это не просьба, а просто новая дата — напишите, что мешает."
            submitLabel="Попросить"
            date={{ label: "Перенести на", initial: t.deadline || "" }}
            busy={sending}
            onCancel={() => setAsking(null)}
            onSubmit={(text, when) => void send(() => askReschedule(t.participantId, when, text))}
          />
        )}
      </div>
    );
  }

  return (
    <div className={"ms" + (embedded ? " ms-embedded" : "")}>
      <div className="ms-head">
        <div>
          <h1 className="ms-title">{embedded ? "Что от вас ждут" : name || "Ваши задачи"}</h1>
          <div className="ms-sub">То, что адресовано вам. Отвечать можно здесь или в мессенджере — это одно и то же.</div>
        </div>
        {/* Свой выход — только когда этот экран и есть всё приложение.
            Внутри трекера выход уже стоит в шапке, и второй рядом с первым
            это вопрос, какой из них настоящий. */}
        {!embedded && (
          <button className="btn btn-small ms-exit" type="button" onClick={() => void signOut()}>
            Выйти
          </button>
        )}
      </div>

      {/* Выше задач, пока не подключено: без мессенджера этот экран —
          единственное место, где человек узнает о задаче, а он сюда не
          заходит. Подключил — строчка уходит в фон. */}
      {messenger && <MessengerLink messenger={messenger} />}

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
                <button className="btn btn-small btn-primary" type="button" onClick={() => void run(() => takeIdea(i.recipientId))}>
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
                  {answered && m.response === "yes" && !m.late && <span className="pill pill-accepted">✅ вы будете</span>}
                  {answered && m.response === "yes" && m.late && <span className="pill pill-accepted">🕐 будете, но опоздаете</span>}
                  {answered && m.response === "no" && <span className="pill pill-blocked">❌ не сможете</span>}
                </div>
                {answered && m.response === "no" && m.reason && <div className="ms-declined">Причина: {m.reason}</div>}
                {/* Кнопки остаются и после ответа: передумать можно до
                    начала — это решение проекта, и в мессенджере оно теперь
                    работает, а здесь до сих пор не работало вовсе: ответив
                    однажды, человек не мог ни исправить ошибку, ни сообщить
                    об изменившихся планах. */}
                {vote && asking?.id !== m.participantId && (
                  <div className="ms-actions">
                    <button className="btn btn-small btn-primary" type="button" onClick={() => void run(() => vote(m.participantId, "yes", ""))}>
                      <Icon name="check" size={15} /> Буду
                    </button>
                    <button className="btn btn-small" type="button" onClick={() => void run(() => vote(m.participantId, "late", ""))}>
                      <Icon name="clock" size={15} /> Опоздаю
                    </button>
                    <button className="btn btn-small" type="button" onClick={() => setAsking({ kind: "vote", id: m.participantId })}>
                      <Icon name="close" size={15} /> Не смогу
                    </button>
                  </div>
                )}
                <button
                  className="btn btn-small ms-chat-toggle"
                  type="button"
                  onClick={() => setChatFor((cur) => (cur === m.meetingId ? null : m.meetingId))}
                >
                  {chatFor === m.meetingId ? "Свернуть обсуждение" : "💬 Обсуждение"}
                </button>
                {chatFor === m.meetingId && <ItemChat kind="meeting" itemId={m.meetingId} />}

                {vote && asking?.id === m.participantId && asking.kind === "vote" && (
                  <ManagerAnswer
                    id={"vote-" + m.participantId}
                    question={`Почему не сможете быть на «${m.title}»?`}
                    emptyHint="Причина обязательна: организатору важно знать, переносить встречу или нет."
                    submitLabel="❌ Отправить"
                    busy={sending}
                    onCancel={() => setAsking(null)}
                    onSubmit={(text) => {
                      if (!canVoteNo(text)) return;
                      void send(() => vote(m.participantId, "no", text));
                    }}
                  />
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
