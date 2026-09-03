"use client";

// Port of the PWA install-button wiring at the top of legacy-tracker.js
// (registered before boot(), independent of auth/data): captures the
// browser's beforeinstallprompt event so a real UI button can replay it
// later, instead of the browser's own (easy to miss) install affordance.
import { useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setVisible(true);
    }
    function onAppInstalled() {
      deferredRef.current = null;
      setVisible(false);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  function promptInstall() {
    const e = deferredRef.current;
    if (!e) return;
    e.prompt();
    e.userChoice.finally(() => {
      deferredRef.current = null;
      setVisible(false);
    });
  }

  return { visible, promptInstall };
}
