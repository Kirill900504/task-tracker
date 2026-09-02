import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "./tracker.css";
import RegisterSW from "./registerSW";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={manrope.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
