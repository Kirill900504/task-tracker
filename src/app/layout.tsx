import type { Metadata } from "next";
import "./globals.css";
import "./tracker.css";

export const metadata: Metadata = {
  title: "Трекер задач",
  description: "Личный таск-трекер",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
