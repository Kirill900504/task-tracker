"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Все вопросы трекера — одним окном трекера.
//
// До этого вопросы задавал браузер: prompt(), confirm(), alert(). Выглядит
// это как чужое системное окно поверх сайта, с заголовком «Подтвердите
// действие на task-tracker-beta-ebon.vercel.app» и синими кнопками Windows,
// и Кирилл назвал это колхозом — справедливо. Но дело не только в виде:
//
//   — В prompt() нельзя ни объяснить, ни проверить ответ. «Что доделать?»
//     с пустым ответом отвечало вторым окном «так нельзя» — два системных
//     окна подряд вместо одной подсказки под полем.
//   — Длинный ответ в одну строку не помещается: комментарий к приёмке
//     набирают в поле шириной с адресную строку.
//   — На телефоне, особенно во встроенном браузере мессенджера, системное
//     окно может не показаться вовсе — и тогда кнопка просто «не работает».
//     Ради этого экран руководителя уже переписали (см. ManagerAnswer), а
//     остальной трекер остался как был.
//
// Поэтому здесь одно окно на все случаи: спросить текст (`ask`), спросить
// «да/нет» (`confirm`), сказать (`say`) и предложить выбор из нескольких
// (`choose`). Оно живёт в корне приложения, рисуется порталом поверх любого
// другого окна и отвечает промисом — то есть заменяет системное окно там же,
// где оно стояло, не переписывая логику вокруг.

type Kind = "ask" | "confirm" | "say" | "choose";

export type AskOptions = {
  title?: string;
  question: string;
  // Пояснение мельче вопроса: то, что человеку полезно знать, но не то, что
  // у него спрашивают.
  note?: string;
  value?: string;
  placeholder?: string;
  // Длинный ответ — комментарий, причина, текст сообщения.
  multiline?: boolean;
  okText?: string;
  cancelText?: string;
  // Пустой ответ не принимается, и окно не закрывается, пока его не напишут.
  required?: string;
};

export type ConfirmOptions = {
  title?: string;
  question: string;
  note?: string;
  okText?: string;
  cancelText?: string;
  // Красная кнопка: удаление и всё, что человек не отменит обратно.
  danger?: boolean;
};

export type SayOptions = {
  title?: string;
  question: string;
  note?: string;
  okText?: string;
  // Код, который надо переписать в другое приложение, и ссылка туда же.
  // Данными, а не разметкой: так их может передать и обычный .ts-хук
  // (useBotLink), а выглядят они одинаково везде, где показываются.
  code?: string;
  link?: { href: string; label: string };
};

export type ChooseOption = { value: string; label: string; danger?: boolean };
export type ChooseOptions = {
  title?: string;
  question: string;
  note?: string;
  options: ChooseOption[];
  cancelText?: string;
};

type Pending =
  | ({ kind: "ask"; resolve: (v: string | null) => void } & AskOptions)
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOptions)
  | ({ kind: "say"; resolve: (v: void) => void } & SayOptions)
  | ({ kind: "choose"; resolve: (v: string | null) => void } & ChooseOptions);

export type AskApi = {
  ask: (options: AskOptions) => Promise<string | null>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  say: (options: SayOptions) => Promise<void>;
  choose: (options: ChooseOptions) => Promise<string | null>;
};

const AskContext = createContext<AskApi | null>(null);

// Нарочно не бросает исключение без провайдера: единственный способ так
// промахнуться — вызвать вопрос из куска, который рисуется вне приложения, и
// уронить из-за этого весь экран было бы хуже самой ошибки. Тогда работают
// системные окна, как раньше.
const FALLBACK: AskApi = {
  ask: async (o) => (typeof window === "undefined" ? null : window.prompt(o.question, o.value || "")),
  confirm: async (o) => (typeof window === "undefined" ? false : window.confirm(o.question)),
  say: async (o) => {
    if (typeof window !== "undefined") window.alert(o.question);
  },
  choose: async () => null,
};

export function useAsk(): AskApi {
  return useContext(AskContext) || FALLBACK;
}

export default function AskProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  // Ответ обещан промисом, и отдать его надо ровно один раз — даже если окно
  // закроют мимо кнопки (Esc, клик по фону).
  const pendingRef = useRef<Pending | null>(null);

  const open = useCallback((next: Pending, initial = "") => {
    pendingRef.current = next;
    setText(initial);
    setProblem("");
    setPending(next);
  }, []);

  // Постоянный объект: он уходит в контекст, и новый на каждую отрисовку
  // перерисовывал бы вообще всё приложение.
  const api = useMemo<AskApi>(
    () => ({
      ask: (options) =>
        new Promise<string | null>((resolve) => open({ kind: "ask", resolve, ...options }, options.value || "")),
      confirm: (options) => new Promise<boolean>((resolve) => open({ kind: "confirm", resolve, ...options })),
      say: (options) => new Promise<void>((resolve) => open({ kind: "say", resolve, ...options })),
      choose: (options) => new Promise<string | null>((resolve) => open({ kind: "choose", resolve, ...options })),
    }),
    [open],
  );

  function close(answer: { kind: Kind; value?: string | null | boolean }) {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setProblem("");
    if (!current) return;
    if (current.kind === "confirm") current.resolve(answer.value === true);
    else if (current.kind === "say") current.resolve();
    else current.resolve((answer.value as string | null) ?? null);
  }

  function cancel() {
    close({ kind: pendingRef.current?.kind || "say", value: null });
  }

  function submit() {
    const current = pendingRef.current;
    if (!current) return;
    if (current.kind === "ask") {
      const value = text.trim();
      // Обязательный ответ проверяется здесь, а не вторым окном после
      // закрытия первого: человек видит подсказку там же, где пишет.
      if (current.required && !value) {
        setProblem(current.required);
        return;
      }
      close({ kind: "ask", value: current.multiline ? text.trim() : value });
      return;
    }
    close({ kind: current.kind, value: true });
  }

  const isOpen = pending !== null;
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
    }
    // Capture: иначе Esc сначала услышит окно под этим (задача, встреча) и
    // закроется оно, а вопрос останется висеть над пустым местом.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancel читает ref, а не состояние
  }, [isOpen]);

  return (
    <AskContext.Provider value={api}>
      {children}
      {pending &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="overlay open ask-overlay" onClick={(e) => e.target === e.currentTarget && cancel()}>
            <div className="modal ask-modal" role="dialog" aria-modal="true">
              <h2>{pending.title || defaultTitle(pending.kind)}</h2>
              <p className="ask-question">{pending.question}</p>
              {pending.note && <p className="ask-note">{pending.note}</p>}

              {pending.kind === "say" && pending.link && (
                <a className="btn btn-primary ask-link" href={pending.link.href} target="_blank" rel="noreferrer">
                  {pending.link.label}
                </a>
              )}
              {pending.kind === "say" && pending.code && <div className="ask-code">{pending.code}</div>}

              {pending.kind === "ask" && (
                <div className="field">
                  {pending.multiline ? (
                    <textarea
                      id="askInput"
                      autoFocus
                      value={text}
                      placeholder={pending.placeholder || ""}
                      onChange={(e) => setText(e.target.value)}
                    />
                  ) : (
                    <input
                      id="askInput"
                      type="text"
                      autoFocus
                      value={text}
                      placeholder={pending.placeholder || ""}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submit();
                        }
                      }}
                    />
                  )}
                </div>
              )}

              {problem && <div className="ask-problem">{problem}</div>}

              <div className="modal-actions ask-actions">
                {pending.kind === "choose" ? (
                  <>
                    {pending.options.map((option) => (
                      <button
                        key={option.value}
                        className={"btn" + (option.danger ? " btn-danger" : " btn-primary")}
                        type="button"
                        onClick={() => close({ kind: "choose", value: option.value })}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button className="btn" type="button" onClick={cancel}>
                      {pending.cancelText || "Отмена"}
                    </button>
                  </>
                ) : (
                  <>
                    {pending.kind !== "say" && (
                      <button className="btn" id="askCancelBtn" type="button" onClick={cancel}>
                        {pending.cancelText || "Отмена"}
                      </button>
                    )}
                    <button
                      className={"btn " + (pending.kind === "confirm" && pending.danger ? "btn-danger" : "btn-primary")}
                      id="askOkBtn"
                      type="button"
                      autoFocus={pending.kind !== "ask"}
                      onClick={submit}
                    >
                      {pending.okText || (pending.kind === "say" ? "Понятно" : "ОК")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </AskContext.Provider>
  );
}

function defaultTitle(kind: Kind): string {
  if (kind === "confirm" || kind === "choose") return "Подтвердите";
  if (kind === "say") return "Трекер";
  return "Вопрос";
}
