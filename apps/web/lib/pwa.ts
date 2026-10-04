"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Captures the install prompt and exposes platform-aware install state. */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(Boolean(standalone));
    const ua = navigator.userAgent;
    setIsIos(/iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua));

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome === "accepted";
  }, [deferred]);

  return { canInstall: Boolean(deferred) && !installed, installed, isIos, promptInstall };
}

interface VersionFile {
  id: string;
  builtAt: string;
}

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as VersionFile;
    return data.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Registers the service worker with a build-id query (so a new deploy installs
 * a new worker) and polls `version.json`. When the deployed build id changes,
 * `updateReady` flips and the UI can ask the user to reload.
 */
export function useAppUpdate() {
  const [updateReady, setUpdateReady] = useState(false);
  const currentId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      const latest = await fetchVersion();
      if (cancelled || !latest) return;
      if (currentId.current && latest !== currentId.current) setUpdateReady(true);
    };

    const init = async () => {
      const id = await fetchVersion();
      if (cancelled || !id) return;
      currentId.current = id;
      if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
        try {
          await navigator.serviceWorker.register(`/sw.js?v=${id}`);
        } catch {
          /* offline caching is best-effort */
        }
      }
      timer = setInterval(check, 15 * 60 * 1000);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", check);
    };

    const onVisible = () => {
      if (!document.hidden) void check();
    };

    void init();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map((r) => r.unregister()));
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* ignore and reload anyway */
    }
    window.location.reload();
  }, []);

  return { updateReady, applyUpdate };
}
