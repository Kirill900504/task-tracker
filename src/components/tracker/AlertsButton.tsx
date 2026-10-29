"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import PopLayer from "./PopLayer";
import Reveal from "./Reveal";
import { shrink } from "@/lib/smoothHeight";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { isQuiet, muteKey, toggleMuted, useAlertPrefs, writeAlertPrefs } from "@/lib/alertPrefs";

// «Без звука» у одного обсуждения — как у чата в Telegram. Стоит в шапке
// обсуждения: там, где шумит, там и выключают. Перенос и отмена встречи
// сквозь это проходят (lib/desktopAlerts).
export function ChatMuteButton({ kind, itemId }: { kind: "task" | "meeting"; itemId: string }) {
  const prefs = useAlertPrefs();
  const muted = prefs.muted.includes(muteKey(kind, itemId));
  const label = muted ? "Уведомления по этому обсуждению выключены — включить" : "Не беспокоить по этому обсуждению";
  return (
    <button
      type="button"
      className={"btn btn-icon chat-mute" + (muted ? " active" : "")}
      title={label}
      aria-label={label}
      aria-pressed={muted}
      onClick={() => toggleMuted(kind, itemId)}
    >
      <Icon name={muted ? "bell-off" : "bell"} size={14} />
    </button>
  );
}

// Колокольчик в шапке — ВСЕ настройки уведомлений в одном месте.
//
// История в три шага, и каждый объясняет нынешний вид. 07.10.2026 он стал
// меню («нужно и предусмотреть иконку или кнопочку „отключить
// уведомления“»). 15.10.2026 появился общий выключатель и рядом с ним
// плашка «Включите уведомления» под шапкой — по снимку корпоративного
// мессенджера. Тем же днём Кирилл её снял: «всплывающие окна мне не
// нравятся и засоряют место, размести все понятно и аккуратно в нашем
// колокольчике». Плашки больше нет, а меню стало панелью с переключателями:
// у меню каждое нажатие закрывает его, и настроить три вещи значило трижды
// открыть колокольчик, а подписи вида «Ход работы: показывать» заставляли
// читать, что сейчас, а что будет после нажатия. Переключатель отвечает на
// это сам: где он стоит — так и есть. Обрезанного заголовка («Сообщения
// коллег, новые задачи и перен…») тоже нет — пояснение стоит строкой под
// главным переключателем и переносится.
//
// Выключено всё — остальные строки не показываются: они ни на что не
// влияют, а настройка, которая ничего не меняет, — та же ложь, что и
// неработающая кнопка. О том, что уведомления выключены, говорит сам
// колокольчик: перечёркнутый, другим цветом. Правила — в lib/alertPrefs.

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function Switch({ id, on, label, onChange }: { id: string; on: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={on} aria-label={label} className={"ap-switch" + (on ? " on" : "")} onClick={onChange}>
      <span className="ap-knob" />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="ap-row">
      <div className="ap-text">
        <div className="ap-title">{title}</div>
        {hint && <div className="ap-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function AlertsPanel({
  anchor,
  permission,
  requestPermission,
  onClose,
}: {
  anchor: DOMRect;
  permission: NotificationPermission | "unsupported";
  requestPermission: () => void;
  onClose: () => void;
}) {
  const prefs = useAlertPrefs();
  const ref = useRef<HTMLDivElement | null>(null);
  useEscapeToClose(onClose);

  // У кнопки, а у нижнего края экрана — вверх; как ActionMenu.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.maxHeight = window.innerHeight - 16 + "px";
    el.style.top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - 8 - el.offsetHeight)) + "px";
    el.style.right = Math.max(8, window.innerWidth - anchor.right) + "px";
  }, [anchor, prefs.enabled]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role=switch]")?.focus();
  }, []);

  return (
    <PopLayer>
      <div className="export-backdrop" onClick={onClose} />
      <div ref={ref} className="alerts-panel" id="alertsPanel" role="dialog" aria-label="Уведомления" style={{ top: -9999, right: 8 }}>
        <AlertSettings permission={permission} requestPermission={requestPermission} />
      </div>
    </PopLayer>
  );
}

// Сами переключатели — общие для колокольчика и личного кабинета
// (28.10.2026: «модернизируй личные кабинеты, чтобы они могли управлять
// настройками, уведомлениями и прочим»). Настройка одна и хранится в одном
// месте (lib/alertPrefs), поэтому и рисует её один компонент: вторая копия
// переключателей разошлась бы с первой при первой же новой строке.
// `idPrefix` — чтобы у двух мест не совпали id переключателей.
export function AlertSettings({
  permission,
  requestPermission,
  idPrefix = "alerts",
}: {
  permission: NotificationPermission | "unsupported";
  requestPermission: () => void;
  idPrefix?: string;
}) {
  const prefs = useAlertPrefs();
  const ref = useRef<HTMLDivElement | null>(null);
  const hourQuiet = prefs.enabled && isQuiet(prefs);
  const [toggled, setToggled] = useState(false);
  return (
    <div ref={ref}>
        <Row
          title="Уведомления"
          hint={prefs.enabled ? "Сообщения коллег, новые задачи, переносы встреч" : "Выключены — ничего не всплывает"}
        >
          <Switch
            id={`${idPrefix}MainSwitch`}
            on={prefs.enabled}
            label="Уведомления"
            onChange={() => {
              // Строки под переключателем уезжают и выплывают плавно
              // (lib/smoothHeight), а не исчезают одним кадром.
              if (prefs.enabled) shrink(ref.current?.querySelector<HTMLElement>(".ap-more") ?? null, 0, () => writeAlertPrefs({ enabled: false }), true);
              else {
                setToggled(true);
                writeAlertPrefs({ enabled: true, quietUntil: "" });
                if (permission === "default") requestPermission();
              }
            }}
          />
        </Row>
        {prefs.enabled && (
          // Включено с самого открытия — строки появляются вместе с панелью,
          // своим движением внутри неё им выплывать незачем.
          <Reveal className="ap-more" appear={toggled}>
            <div className="ap-sep" />
            <Row title="Ход работы" hint="Принял, сдал, вернули, сдвинули срок">
              <Switch id={`${idPrefix}ProgressSwitch`} on={prefs.progress} label="Ход работы" onChange={() => writeAlertPrefs({ progress: !prefs.progress })} />
            </Row>
            <Row title="За 15 минут до встречи">
              <Switch id={`${idPrefix}RemindersSwitch`} on={prefs.reminders} label="За 15 минут до встречи" onChange={() => writeAlertPrefs({ reminders: !prefs.reminders })} />
            </Row>
            <Row title="Тишина на час" hint={hourQuiet ? `До ${hhmm(prefs.quietUntil)}` : "Через час всё вернётся само"}>
              <Switch
                id={`${idPrefix}QuietSwitch`}
                on={hourQuiet}
                label="Тишина на час"
                onChange={() => writeAlertPrefs({ quietUntil: hourQuiet ? "" : new Date(Date.now() + 3600_000).toISOString() })}
              />
            </Row>
            {prefs.muted.length > 0 && (
              <Row title="Обсуждения без звука" hint={`${prefs.muted.length} шт.`}>
                <button type="button" className="btn ap-btn" id={`${idPrefix}UnmuteBtn`} onClick={() => writeAlertPrefs({ muted: [] })}>
                  Вернуть
                </button>
              </Row>
            )}
            {permission === "default" && (
              <Row title="Поверх всех окон" hint="Сейчас — только внутри трекера">
                <button type="button" className="btn ap-btn" id={`${idPrefix}AllowBtn`} onClick={requestPermission}>
                  Разрешить
                </button>
              </Row>
            )}
            {permission === "denied" && <div className="ap-note">Окна Windows запрещены в браузере — показываю внутри трекера.</div>}
          </Reveal>
        )}
    </div>
  );
}

export default function AlertsButton({
  permission,
  requestPermission,
}: {
  permission: NotificationPermission | "unsupported";
  requestPermission: () => void;
}) {
  const prefs = useAlertPrefs();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const quiet = isQuiet(prefs);
  const label = !prefs.enabled ? "Уведомления выключены" : quiet ? `Уведомления: тишина до ${hhmm(prefs.quietUntil)}` : "Уведомления";
  return (
    <>
      <button
        className={"btn btn-icon" + (prefs.enabled && !quiet ? " active" : "") + (!prefs.enabled ? " bell-off-all" : "")}
        id="notifPermBtn"
        title={label}
        aria-label={label}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <Icon name={quiet ? "bell-off" : "bell"} size={15} />
      </button>
      {anchor && <AlertsPanel anchor={anchor} permission={permission} requestPermission={requestPermission} onClose={() => setAnchor(null)} />}
    </>
  );
}
