"use client";

import { useState } from "react";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import Icon from "./Icon";
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

// Колокольчик в шапке — «отключить уведомления» (07.10.2026: «нужно и
// предусмотреть иконку или кнопочку „отключить уведомления“, чтобы любой
// человек мог мутить менее важные события при работе в трекере»).
//
// До этого он умел одно — попросить у браузера разрешение, — а получив его,
// становился неактивной картинкой. Теперь он и есть место, где уведомления
// настраивают: что считать менее важным, тишина на час и снятие «не
// беспокоить» с обсуждений. Что выключить нельзя, сказано в заголовке меню,
// чтобы отсутствие пункта не читалось как забытый пункт. Правила — в
// lib/alertPrefs.

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

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

  const items: ActionMenuItem[] = [];
  if (permission === "default") {
    items.push({ id: "allow", label: "Показывать поверх всех окон", icon: "bell", onSelect: requestPermission });
  }
  items.push(
    quiet
      ? { id: "quiet", label: `Снять тишину (до ${hhmm(prefs.quietUntil)})`, icon: "bell", onSelect: () => writeAlertPrefs({ quietUntil: "" }) }
      : {
          id: "quiet",
          label: "Тишина на час",
          icon: "bell-off",
          onSelect: () => writeAlertPrefs({ quietUntil: new Date(Date.now() + 3600_000).toISOString() }),
        },
    {
      id: "progress",
      label: prefs.progress ? "Ход работы: показывать" : "Ход работы: не показывать",
      icon: prefs.progress ? "check" : "bell-off",
      onSelect: () => writeAlertPrefs({ progress: !prefs.progress }),
    },
    {
      id: "reminders",
      label: prefs.reminders ? "За 15 минут до встречи: напоминать" : "За 15 минут до встречи: молчать",
      icon: prefs.reminders ? "check" : "bell-off",
      onSelect: () => writeAlertPrefs({ reminders: !prefs.reminders }),
    },
  );
  if (prefs.muted.length) {
    items.push({ id: "unmute", label: `Вернуть звук обсуждениям (${prefs.muted.length})`, icon: "bell", onSelect: () => writeAlertPrefs({ muted: [] }) });
  }

  const label = quiet ? `Уведомления: тишина до ${hhmm(prefs.quietUntil)}` : "Уведомления";
  return (
    <>
      <button
        className={"btn btn-icon" + (permission === "granted" && !quiet ? " active" : "")}
        id="notifPermBtn"
        title={permission === "denied" ? "Уведомления: окна Windows запрещены для этого сайта, показываю внутри трекера" : label}
        aria-label={label}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <Icon name={quiet || permission !== "granted" ? "bell-off" : "bell"} size={15} />
      </button>
      {anchor && (
        <ActionMenu
          anchor={anchor}
          title="Сообщения коллег, новые задачи и переносы встреч приходят всегда"
          items={items}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
