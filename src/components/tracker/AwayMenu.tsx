"use client";

import { useCallback } from "react";
import { useAsk } from "@/components/Ask";
import { useColleagues, type Colleague } from "@/hooks/useColleagues";
import { AWAY_KINDS, awayPhrase, awayUntilChoices, isAwayOn, parseAwayDate, type AwayKind } from "@/lib/away";
import { todayStr } from "@/lib/taskDisplay";
import { withoutSelfMark } from "@/lib/actorName";

// «Меня нет до…» — два вопроса кнопками: почему и до какого дня (миграция
// 0047). Один и тот же вопрос задают меню шапки (про себя) и «Команда»
// (владелец — про любого), поэтому он живёт здесь, а не в каждом из них.
//
// Своя дата — третьим шагом и только если нажали «До даты…»: кнопки
// покрывают почти все случаи, а поле, открытое всегда, превратило бы
// отметку в заполнение формы.
export function useAwayEditor() {
  const ask = useAsk();
  const { reload } = useColleagues();

  return useCallback(
    async (person: Colleague) => {
      const today = todayStr();
      const away = isAwayOn(person.awayUntil, today);
      const who = person.isMe ? "Вас" : withoutSelfMark(person.name);
      const kind = await ask.choose({
        title: person.isMe ? "Меня нет" : `Нет на месте: ${withoutSelfMark(person.name)}`,
        question: away
          ? `Сейчас ${person.isMe ? "вы" : who} ${awayPhrase(person.awayKind, person.awayUntil)}.`
          : "Почему?",
        note: "Пока человека нет, трекер не напоминает ему о сроках, а в формах рядом с его именем видно, до какого дня его нет.",
        options: [
          ...(away ? [{ value: "back", label: person.isMe ? "Я на месте" : "Уже на месте" }] : []),
          ...AWAY_KINDS.map((k) => ({ value: k.value, label: k.label })),
        ],
      });
      if (!kind) return;

      let until = "";
      if (kind !== "back") {
        const picked = await ask.choose({
          title: AWAY_KINDS.find((k) => k.value === kind)?.label || "Отсутствие",
          question: "До какого дня включительно?",
          options: [...awayUntilChoices(today), { value: "custom", label: "До даты…" }],
        });
        if (!picked) return;
        until = picked;
        if (picked === "custom") {
          const text = await ask.ask({
            title: "До какого дня",
            question: "Последний день отсутствия",
            placeholder: "например, 15.10",
            required: "Напишите дату — например, 15.10",
          });
          if (!text) return;
          const parsed = parseAwayDate(text, today);
          if (!parsed) {
            await ask.say({ question: `Не понял дату «${text}». Напишите её так: 15.10` });
            return;
          }
          until = parsed;
        }
      }

      const res = await fetch("/api/workspace/away", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: person.id, until, kind: kind === "back" ? undefined : (kind as AwayKind) }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || data?.error) {
        await ask.say({ title: "Не сохранилось", question: data?.error || "Нет связи с облаком. Попробуйте ещё раз." });
        return;
      }
      reload();
    },
    [ask, reload],
  );
}
