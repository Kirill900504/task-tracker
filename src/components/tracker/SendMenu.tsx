"use client";

import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import { sendToTelegram, useColleagues } from "@/hooks/useColleagues";
import { sendResultText, sendTargets, unreachableNames } from "@/lib/sendTargets";
import { withoutSelfMark } from "@/lib/actorName";

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
  mode: fixedMode,
}: {
  kind: "task" | "meeting" | "idea";
  // У мысли «Отправить» и «Поделиться» — две разные кнопки на карточке
  // (21.10.2026), и способ известен до меню: окно «Передать мысль» с тем
  // же выбором было вторым вопросом об уже сказанном.
  mode?: "send" | "share";
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
  // Себе не отправляют — своя строка в списке есть (её видно в «Команде»),
  // но адресатом быть не может.
  // Мысль — всем: она доходит и в список мыслей получателя в трекере, а не
  // только в мессенджер (api/telegram/send, 14.10.2026 — «почему не полный
  // список возможных адресатов?»). Задача и встреча по-прежнему уходят
  // сообщением, и предлагать их тому, до кого сообщение не дойдёт, значило
  // бы обещать доставку, которой не будет.
  const linked = colleagues.filter((c) => (kind === "idea" || c.linked) && !c.isMe).map((c) => c.name);
  const targets = sendTargets(linked, concerns);
  const suggested = targets.filter((t) => t.suggested).map((t) => t.name);
  const missing = unreachableNames(linked, concerns);

  // Отправляем по полному имени строки, а показываем имя: пометка «(я)»
  // написана для одного человека, а меню читают все (lib/actorName).
  const shown = (name: string) => withoutSelfMark(name);

  async function send(names: string[]) {
    // Мысль передают двумя способами (решение Кирилла 23.09.2026, миграция
    // 0051): «Отправить» — уходит из моего списка, человек обязан ответить;
    // «Поделиться» — остаётся у меня, а у него появляется в списке. До
    // 21.10.2026 способ спрашивало окно «Передать мысль» после выбора
    // человека — оно же было подтверждением после случая 25.09.2026, когда
    // старая мысль ушла не тому одним случайным нажатием. Теперь способ —
    // две кнопки на карточке, и окно снято его словами («исключить окно
    // дополнительного уточнения»): меню открыто кнопкой, которая уже
    // назвала, что произойдёт, а «кому» видно в заголовке меню.
    const mode = kind === "idea" ? (fixedMode ?? "send") : undefined;
    onResult(names.length > 1 ? "Отправляю…" : `Отправляю ${shown(names[0])}…`);
    const result = await sendToTelegram(kind, id, names, mode);
    onResult("error" in result ? result.error : sendResultText(result));
  }

  const items: ActionMenuItem[] = [];
  // One tap for the usual case: everyone this meeting is actually about.
  if (suggested.length > 1) {
    items.push({ id: "__all", label: `✈ Всем: ${suggested.map(shown).join(", ")}`, onSelect: () => send(suggested) });
  }
  for (const target of targets) {
    items.push({
      id: target.name,
      label: (target.suggested ? "✈ " : "→ ") + shown(target.name),
      onSelect: () => send([target.name]),
    });
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
    items.push({ id: "__missing", label: `⚠ Не в мессенджере: ${missing.map(shown).join(", ")}`, onSelect: () => {} });
  }

  return <ActionMenu anchor={anchor} title={fixedMode === "share" ? "С кем поделиться" : "Кому отправить"} items={items} onClose={onClose} />;
}
