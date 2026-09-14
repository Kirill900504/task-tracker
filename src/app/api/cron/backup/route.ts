import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramDocument, sendTelegramMessage } from "@/lib/telegram";
import { sendMaxDocument, sendMaxMessage } from "@/lib/max";
import { groupBackupTargets, type BackupDestination } from "@/lib/backupTargets";

// Weekly backup: everyone who has linked a messenger gets their own tasks/
// meetings/ideas/assignees as a JSON file. Runs off Vercel's own (free,
// once-a-day-granularity) cron — see vercel.json — since once a week
// comfortably fits that granularity, unlike the reminders cron which needed
// an external 5-minute pinger.
//
// It used to go to Telegram only, because MAX could not upload a file. Now
// it can (sendMaxDocument), so the copy goes wherever the person actually
// reads their messages — and a person with both gets both, which is the
// point of a backup rather than a duplicate to be tidied away.

type Destination = BackupDestination;

async function sendDocument(to: Destination, filename: string, content: string, caption: string) {
  return to.channel === "telegram"
    ? sendTelegramDocument(to.chatId, filename, content, caption)
    : sendMaxDocument(to.chatId, filename, content, caption);
}

async function sendNote(to: Destination, text: string) {
  if (to.channel === "telegram") await sendTelegramMessage(to.chatId, text);
  else await sendMaxMessage(to.chatId, text);
}

export async function GET(req: Request) {
  // Vercel's own Cron Jobs feature (unlike the external pinger the
  // reminders route needs) automatically sends this header when CRON_SECRET
  // is set as a project env var — no secret needs to live in vercel.json.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [telegram, max] = await Promise.all([
    admin.from("telegram_accounts").select("telegram_chat_id, user_id"),
    admin.from("max_accounts").select("max_user_id, user_id"),
  ]);

  // Grouped by person, not by chat: the export is built once and the purge
  // below must happen once, however many messengers that person reads.
  const byUser = groupBackupTargets(telegram.data || [], max.data || []);
  if (!byUser.size) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  let failed = 0;
  for (const [userId, destinations] of byUser) {
    const [tasks, meetings, ideas, assignees] = await Promise.all([
      admin.from("tasks").select("*").eq("user_id", userId),
      admin.from("meetings").select("*").eq("user_id", userId),
      admin.from("ideas").select("*").eq("user_id", userId),
      admin.from("assignees").select("*").eq("user_id", userId),
    ]);

    const broken = [tasks, meetings, ideas, assignees].find((r) => r.error);
    if (broken) {
      for (const to of destinations) await sendNote(to, "⚠ Не получилось сделать резервную копию: " + broken.error!.message);
      failed++;
      continue;
    }

    const payload = {
      exported_at: new Date().toISOString(),
      tasks: tasks.data,
      meetings: meetings.data,
      ideas: ideas.data,
      assignees: assignees.data,
    };
    const today = new Date().toISOString().slice(0, 10);
    const file = JSON.stringify(payload, null, 2);

    // «Delivered» means at least one messenger took the file. One channel
    // being down is not a reason to withhold the copy from the other, and it
    // is not a reason to purge as if both had worked either.
    let delivered = false;
    for (const to of destinations) {
      const result = await sendDocument(to, `tracker-backup-${today}.json`, file, `📦 Еженедельная резервная копия (${today})`);
      if (result.ok) {
        delivered = true;
        sent++;
      } else {
        failed++;
        await sendNote(to, "⚠ Резервная копия не отправилась: " + (result.error || "неизвестно"));
      }
    }

    // Soft-deleted (spec-audit #4) rows older than 30 days are purged for
    // real — but only *after* a backup that still includes them has actually
    // arrived somewhere, so nothing is ever truly gone without a last copy
    // existing. Before, this ran whether or not the send worked.
    if (!delivered) continue;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await Promise.all([
      admin.from("tasks").delete().eq("user_id", userId).lt("deleted_at", cutoff),
      admin.from("meetings").delete().eq("user_id", userId).lt("deleted_at", cutoff),
      admin.from("ideas").delete().eq("user_id", userId).lt("deleted_at", cutoff),
    ]);
  }

  return NextResponse.json({ ok: true, sent, failed });
}
