import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./tracker.css";
import RegisterSW from "./registerSW";

export const metadata: Metadata = {
  title: "Постановщик задач",
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
    <html lang="ru" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
