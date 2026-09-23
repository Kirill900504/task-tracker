"use client";

// Иконки Telegram и MAX — единственное место в трекере, где значок несёт
// цвет чужого бренда, а не контур из общего набора (Icon.tsx). Сделано
// нарочно: рядом с «Подключить Telegram» контурная линия говорит не больше
// слова, а узнаваемый синий кружок или чёрный квадрат отвечает на вопрос
// «куда я попаду» ещё до нажатия — Кирилл прямо попросил «желательно с
// официальными иконками подключения МАХ и ТГ» (23.09.2026). Не пиксель в
// пиксель повторяющие логотип — общее по цвету и силуэту достаточно для
// внутреннего инструмента, а точную графику держит сама компания.

export function TelegramBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill="#29A9EA" />
      <path
        d="M17.6 7.3 15.8 16c-.13.6-.5.74-1 .46l-2.77-2.04-1.34 1.29c-.15.15-.27.27-.56.27l.2-2.83 5.15-4.65c.22-.2-.05-.31-.34-.11l-6.37 4-2.74-.86c-.6-.19-.6-.6.13-.89l10.7-4.12c.5-.18.94.12.78.9Z"
        fill="#fff"
      />
    </svg>
  );
}

export function MaxBrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#171717" />
      <text x="12" y="15.8" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="Arial, sans-serif" fill="#fff" letterSpacing=".2">
        MAX
      </text>
    </svg>
  );
}
