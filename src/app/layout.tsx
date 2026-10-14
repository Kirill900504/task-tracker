import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "./tracker.css";
// Кубик и окно задачи/встречи — после tracker.css нарочно: правила там
// переопределяют прежний вид (см. шапку task-ui.css).
import "./task-ui.css";
// Потолок роста текстовых полей — последним, поверх обоих файлов выше.
import "./text-fields.css";
import RegisterSW from "./registerSW";
import CrashWatch from "./CrashWatch";
import VersionWatch from "./VersionWatch";
import MiniAppChrome from "./MiniAppChrome";
import AskProvider from "@/components/Ask";

// Self-hosted at build time by next/font (no runtime request, no layout
// shift) — Manrope's Cyrillic subset covers Russian, so it works as the
// display face for an all-Russian UI, not just a Latin-only nicety.
const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Планировщик задач",
  description: "Личный таск-трекер",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#232B2E",
  // Ширина экрана и масштаб 1 — то, что Next ставит сам; перечислены
  // потому, что своё описание окна заменяет его целиком, а не дополняет.
  width: "device-width",
  initialScale: 1,
  // Пальцами не увеличивается. Слова Кирилла 20.09.2026: «в мобильном
  // приложении и мини-приложениях не должно быть возможности
  // увеличить-уменьшить». Причина не в строгости: трекер — это списки и
  // кнопки, растянутые по ширине экрана, и случайное разведение пальцев
  // при прокрутке оставляет человека на съехавшей вбок странице, из
  // которой в окне без адресной строки (установленное приложение,
  // мини-приложение мессенджера) не выбраться ничем, кроме перезапуска.
  // Цена известна и принята: мелкий текст теперь нельзя приблизить, и
  // поэтому размеры на телефоне заданы «под палец», а не «помельче, всё
  // равно увеличат». На компьютере это описание не действует вовсе —
  // масштаб окна там в руках браузера.
  maximumScale: 1,
  userScalable: false,
  // Под вырез и под полосу жестов. Без этого env(safe-area-inset-*),
  // которыми в мобильном блоке отодвинуты шапка и нижняя панель, равны
  // нулю — то есть половина отступов в tracker.css просто не работала.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Цвет фона — прямо в теге, а не только в globals.css: стили приезжают
    // отдельным файлом, и до них окно белое. На медленной сети это и был
    // «белый экран» при открытии (14.10.2026) — тёмный трекер начинался с
    // белой вспышки, а на сети, где файл стилей не доехал, белым и
    // оставался. Значение то же, что --paper и themeColor ниже.
    <html lang="ru" className={manrope.variable} style={{ backgroundColor: "#232B2E" }} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RegisterSW />
        {/* Поломка, о которой знает только пострадавший, — это отсутствующий
            орган чувств: см. lib/crashReport.ts. */}
        <CrashWatch />
        {/* Открытое окно не должно жить на вчерашнем коде: см. VersionWatch. */}
        <VersionWatch />
        {/* Окно мессенджера: во весь экран, своего цвета и не
            закрывающееся от прокрутки. Ничего не рисует и вне
            мини-приложения не делает ничего. */}
        <MiniAppChrome />
        {/* Вопросы задаёт трекер, а не браузер: окно живёт здесь, чтобы
            быть доступным на любой странице и рисоваться поверх всего. */}
        <AskProvider>{children}</AskProvider>
      </body>
    </html>
  );
}
