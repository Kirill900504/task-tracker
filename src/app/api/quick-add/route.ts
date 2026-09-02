import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseQuickAdd } from "@/lib/quickAdd";
import { checkRateLimit } from "@/lib/rateLimit";
import { logAiAction } from "@/lib/aiActionLog";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(supabase, user.id, "quick-add", 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: "Слишком много запросов, подождите минуту" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const assignees: string[] = Array.isArray(body?.assignees) ? body.assignees : [];
  if (!text) {
    return NextResponse.json({ error: "Пустой текст" }, { status: 400 });
  }

  try {
    const result = await parseQuickAdd(text, assignees);
    await logAiAction(supabase, {
      userId: user.id,
      source: "web",
      inputText: text,
      success: true,
      resultSummary: result.items.map((it) => it.tool).join(", "),
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logAiAction(supabase, { userId: user.id, source: "web", inputText: text, success: false, errorMessage: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
