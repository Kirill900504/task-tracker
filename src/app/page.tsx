import Script from "next/script";
import SupabaseBootstrap from "./SupabaseBootstrap";
import QuickAdd from "./QuickAdd";
import { TRACKER_BODY_HTML } from "./trackerMarkup";

export default function Home() {
  return (
    <>
      <SupabaseBootstrap />
      <div dangerouslySetInnerHTML={{ __html: TRACKER_BODY_HTML }} />
      <QuickAdd />
      <Script src="/legacy-tracker.js" strategy="afterInteractive" />
    </>
  );
}
