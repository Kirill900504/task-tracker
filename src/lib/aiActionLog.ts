import type { SupabaseClient } from "@supabase/supabase-js";

// Best-effort logging of every GigaChat quick-add call — spec-audit
// recommendation #2. Never throws: a logging failure must never break the
// actual request it's trying to record.
export async function logAiAction(
  client: SupabaseClient,
  params: {
    userId: string;
    source: "telegram" | "web";
    inputText: string;
    success: boolean;
    resultSummary?: string;
    errorMessage?: string;
  },
): Promise<void> {
  try {
    await client.from("ai_action_logs").insert({
      user_id: params.userId,
      source: params.source,
      input_text: params.inputText.slice(0, 2000),
      success: params.success,
      result_summary: params.resultSummary?.slice(0, 2000) || null,
      error_message: params.errorMessage?.slice(0, 2000) || null,
    });
  } catch {
    // Swallow — see comment above.
  }
}
