import { createClient } from "@supabase/supabase-js";
import { readFileSync, rmSync } from "node:fs";
import { userFilePath } from "./userFile";

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Только СВОЙ файл и только свой аккаунт: раньше имя было общим, и
  // уборка одного прогона удаляла пользователя, под которым в эту секунду
  // работал другой (см. e2e/userFile.ts).
  const userFile = userFilePath();
  if (!url || !serviceKey) return;

  try {
    const { id } = JSON.parse(readFileSync(userFile, "utf8"));
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await admin.auth.admin.deleteUser(id);
  } catch {
    // Nothing to clean up (setup never ran / already gone) — fine.
  } finally {
    try {
      rmSync(userFile, { force: true });
    } catch {
      /* best effort */
    }
  }
}
