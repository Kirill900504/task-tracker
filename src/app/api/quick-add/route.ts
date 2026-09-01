import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseQuickAdd } from "@/lib/quickAdd";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const assignees: string[] = Array.isArray(body?.assignees) ? body.assignees : [];
  if (!text) {
    return NextResponse.json({ error: "Пустой текст" }, { status: 400 });
  }

  try {
    const result = await parseQuickAdd(text, assignees);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
