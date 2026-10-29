import { NextResponse } from "next/server";
import { desktopInstallerUrl } from "@/lib/welcomeInvite";

// Постоянная ссылка «скачать приложение для Windows»: /api/download всегда
// ведёт на установщик ПОСЛЕДНЕГО выпуска. Имя файла меняется с каждой
// версией, а ссылку дают людям и ставят в личный кабинет — она не должна
// стареть вместе с выпуском (lib/welcomeInvite.desktopInstallerUrl).
export async function GET() {
  const { url } = await desktopInstallerUrl();
  return NextResponse.redirect(url, 302);
}
