"use client";

import { createClient } from "@/lib/supabase/client";

declare global {
  interface Window {
    supabase?: ReturnType<typeof createClient>;
  }
}

if (typeof window !== "undefined" && !window.supabase) {
  window.supabase = createClient();
}

export default function SupabaseBootstrap() {
  return null;
}
