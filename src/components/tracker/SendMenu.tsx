"use client";

import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import { sendToTelegram, useColleagues } from "@/hooks/useColleagues";
import { sendResultText, sendTargets, unreachableNames } from "@/lib/sendTargets";

// «Кому отправить» — the one menu behind every ✈ in the tracker.
//
// A task, a meeting and a thought are all sent the same way and answer the
// same way, so the difference between them lives entirely in two props: what
// kind of thing it is, and who it already concerns. Everything else — who is
// reachable, what one tap means, how the outcome is worded — is here, once.
//
// Only the id travels to the server; the text is read back there from the
// database (see api/telegram/send), so nothing about what a colleague
// receives is decided in the browser.

export default function SendMenu({
  kind,
  id,
  concerns,
  anchor,
  onClose,
  onResult,
}: {
  kind: "task" | "meeting" | "idea";
  id: string;
  // The assignee of a task, the participants of a meeting — offered first.
  concerns?: string[];
  // Where the ✈ that opened this is; unused by the phone's bottom sheet.
  anchor: DOMRect | null;
  onClose: () => void;
  // Said out loud by whoever opened the menu: a toast in the lists, the
  // line under the form in the modals.
  onResult: (message: string) => void;
}) {
  const { colleagues, loading } = useColleagues();
  const linked = colleagues.filter((c) => c.linked).map((c) => c.name);
  const targets = sendTargets(linked, concerns);
  const suggested = targets.filter((t) => t.suggested).map((t) => t.name);
  const missing = unreachableNames(linked, concerns);

  async function send(names: string[]) {
    onResult(names.length > 1 ? "Отправляю…" : `Отправляю ${names[0]}…`);
    const result = await sendToTelegram(kind, id, names);
    onResult("error" in result ? result.error : sendResultText(result));
  }

  const items: ActionMenuItem[] = [];
  // One tap for the usual case: everyone this meeting is actually about.
  if (suggested.length > 1) {
    items.push({ id: "__all", label: `✈ Всем: ${suggested.join(", ")}`, onSelect: () => send(suggested) });
  }
  for (const target of targets) {
    items.push({ id: target.name, label: (target.suggested ? "✈ " : "→ ") + target.name, onSelect: () => send([target.name]) });
  }
  if (!items.length) {
    items.push({
      id: "__none",
      label: loading ? "Смотрю, кто на связи…" : "Никто не подключён к мессенджеру — «Команда» ⚙",
      onSelect: () => {},
    });
  } else if (missing.length) {
    // Not an error — you can still send it to someone else — but the reason
    // the obvious name is missing from this list should not be a mystery.
    items.push({ id: "__missing", label: `⚠ Не в мессенджере: ${missing.join(", ")}`, onSelect: () => {} });
  }

  return <ActionMenu anchor={anchor} title="Кому отправить" items={items} onClose={onClose} />;
}
