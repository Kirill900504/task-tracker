import Script from "next/script";
import SupabaseBootstrap from "./SupabaseBootstrap";
import QuickAdd from "./QuickAdd";
import { TRACKER_BODY_HTML } from "./trackerMarkup";
import NewTracker from "./NewTracker";

// Feature flag for the in-progress React + TypeScript rewrite (see the
// approved migration plan). Off by default — the legacy vanilla-JS UI below
// is what's actually deployed to production until each phase of the new UI
// is built and verified. Flip with NEXT_PUBLIC_NEW_UI=1.
const NEW_UI_ENABLED = process.env.NEXT_PUBLIC_NEW_UI === "1";

export default function Home() {
  if (NEW_UI_ENABLED) {
    return <NewTracker />;
  }

  return (
    <>
      <SupabaseBootstrap />
      <div dangerouslySetInnerHTML={{ __html: TRACKER_BODY_HTML }} />
      <QuickAdd />
      <Script src="/legacy-tracker.js" strategy="afterInteractive" />
    </>
  );
}
