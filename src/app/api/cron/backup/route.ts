import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramDocument, sendTelegramMessage } from "@/lib/telegram";

// Weekly backup: every linked Telegram account gets its own tasks/meetings/
// ideas/assignees as a JSON file, sent as a Telegram document. Runs off
// Vercel's own (free, once-a-day-granularity) cron — see vercel.json — since
// once a week comfortably fits that granularity, unlike the reminders cron
// which needed an external 5-minute pinger.

export async function GET(req: Request) {
  // Vercel's own Cron Jobs feature (unlike the external pinger the
  // reminders route needs) automatically sends this header when CRON_SECRET
  // is set as a project env var — no secret needs to live in vercel.json.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: accounts } = await admin.from("telegram_accounts").select("telegram_chat_id, user_id");
  if (!accounts || !accounts.length) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  for (const acc of accounts) {
    const chatId = acc.telegram_chat_id as number;
    const userId = acc.user_id as string;

    const [tasks, meetings, ideas, assignees] = await Promise.all([
      admin.from("tasks").select("*").eq("user_id", userId),
      admin.from("meetings").select("*").eq("user_id", userId),
      admin.from("ideas").select("*").eq("user_id", userId),
      admin.from("assignees").select("*").eq("user_id", userId),
    ]);

    const failed = [tasks, meetings, ideas, assignees].find((r) => r.error);
    if (failed) {
      await sendTelegramMessage(chatId, "⚠ Не получилось сделать резервную копию: " + failed.error!.message);
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
    await sendTelegramDocument(
      chatId,
      `tracker-backup-${today}.json`,
      JSON.stringify(payload, null, 2),
      `📦 Еженедельная резервная копия (${today})`,
    );
    sent++;

    // Soft-deleted (spec-audit #4) rows older than 30 days are purged for
    // real — but only *after* this week's backup above, which still
    // includes them, so nothing is ever truly gone without a last copy
    // existing somewhere.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await Promise.all([
      admin.from("tasks").delete().eq("user_id", userId).lt("deleted_at", cutoff),
      admin.from("meetings").delete().eq("user_id", userId).lt("deleted_at", cutoff),
      admin.from("ideas").delete().eq("user_id", userId).lt("deleted_at", cutoff),
    ]);
  }

  return NextResponse.json({ ok: true, sent });
}
