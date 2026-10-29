"use client";

import { PASSWORD_RULES } from "@/lib/workspaceInvite";

// Требования к паролю под полем, пока его набирают: каждое загорается
// галочкой, как только выполнено. Список один — PASSWORD_RULES, тот же, по
// которому сервер отказывает, — поэтому подсказка не может разойтись с
// отказом. «Пароли совпадают» — только там, где пароль повторяют.
//
// Пустое поле подсказок не показывает: строка серых требований под пустым
// полем — это ещё одна надпись, которую никто не читает (CLAUDE.md, «Каждый
// сантиметр экрана — рабочий»).
export default function PasswordHints({ password, repeat }: { password: string; repeat?: string }) {
  if (!password) return null;
  const items = PASSWORD_RULES.map((rule) => ({ label: rule.label, ok: rule.ok(password) }));
  if (repeat !== undefined && repeat) items.push({ label: "пароли совпадают", ok: password === repeat });
  return (
    <ul className="password-hints" aria-live="polite">
      {items.map((item) => (
        <li key={item.label} className={item.ok ? "ok" : ""}>
          <span aria-hidden>{item.ok ? "✓" : "•"}</span> {item.label}
        </li>
      ))}
    </ul>
  );
}
