"use client";

import { useState } from "react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

// Смайлики в тексте сообщения — кнопка ☺ у поля ввода, как в Telegram и
// MAX. 13.10.2026: «сделать чаты внутри задач и встреч как чат классического
// мессенджера… возможностью добавлять смайлики в сообщения».
//
// Набор свой и небольшой, а не вся таблица Unicode: рабочая переписка
// обходится сотней знаков, а список из трёх тысяч — это поиск вместо
// нажатия. Первой вкладкой — недавние, как у всех мессенджеров: человек
// пользуется пятью-шестью, и искать их каждый раз — лишняя работа. Помнятся
// они в браузере: это привычка руки на этом компьютере, а не данные.
//
// Окно лежит над полем, внутри обсуждения, а не отдельным слоем: оно
// принадлежит полю ввода и уходит вместе с ним (см. «Ничто не всплывает
// поверх кнопок наполовину» в CLAUDE.md — здесь оно накрывает только ленту
// над полем, которую в эту секунду не читают).

const GROUPS: { id: string; label: string; emojis: string[] }[] = [
  {
    id: "faces",
    label: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "😉", "😊", "😇", "🥰", "😍", "😘", "😋",
      "😎", "🤓", "🧐", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😬", "😌", "😔", "😪", "😴", "😷",
      "🤒", "🤯", "🥳", "😳", "🥺", "😢", "😭", "😤", "😡", "🤬", "😱", "😨", "😰", "😓", "🤗", "🤫",
      "🤭", "🫡", "😮", "😯", "😲", "🥱", "🤐", "🥴", "🤝", "😈", "💀", "🤡", "👻", "🤖",
    ],
  },
  {
    id: "hands",
    label: "👍",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐",
      "👋", "👏", "🙌", "🙏", "💪", "✍️", "🤝", "🫶", "👊", "✊", "🤛", "🤜", "👀", "🧠",
    ],
  },
  {
    id: "hearts",
    label: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❣️", "💕", "💯", "🔥", "✨", "⭐", "🌟", "⚡", "💥", "🎉", "🎊", "🏆", "🥇", "🎯", "🚀"],
  },
  {
    id: "work",
    label: "✅",
    emojis: [
      "✅", "☑️", "✔️", "❌", "❗", "❓", "⚠️", "⛔", "🚫", "🔴", "🟠", "🟡", "🟢", "🔵", "⏰", "⏳",
      "📅", "📆", "🗓", "📌", "📍", "📎", "📝", "📋", "📊", "📈", "📉", "💼", "📦", "🧾", "💰", "💳",
      "📞", "📱", "💻", "🖥", "🖨", "⌨️", "🔧", "🛠", "🔑", "🔒", "📣", "💡", "📢", "🚗", "☕", "🍕",
    ],
  },
];

const RECENT_KEY = "rokas:recent-emoji";
const RECENT_MAX = 16;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* хранилище закрыто — недавних просто не будет */
  }
}

export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [recent] = useState(readRecent);
  const [tab, setTab] = useState(recent.length ? "recent" : "faces");
  const tabs = [...(recent.length ? [{ id: "recent", label: "🕘", emojis: recent }] : []), ...GROUPS];
  const shown = tabs.find((t) => t.id === tab) ?? tabs[0];
  // Escape закрывает только выбор смайликов, не окно задачи: общий хук
  // слушает раньше всех и снимает «запрос на закрытие» у <dialog>. Свой
  // обработчик на разметке не годился — фокус после нажатия стоит на
  // кнопке у поля, и до него Escape не доходил (поймал e2e 13.10.2026).
  useEscapeToClose(onClose);

  return (
    <div
      className="emoji-picker"
      role="dialog"
      aria-label="Смайлики"
    >
      <div className="emoji-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"emoji-tab" + (t.id === shown.id ? " on" : "")}
            title={t.id === "recent" ? "Недавние" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {shown.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="emoji-cell"
            onClick={() => {
              rememberEmoji(emoji);
              onPick(emoji);
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
