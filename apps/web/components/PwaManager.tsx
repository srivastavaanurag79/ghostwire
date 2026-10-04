"use client";

import { useState } from "react";
import { useAppUpdate } from "@/lib/pwa";

/**
 * Registers the service worker and shows a small banner when a newer deploy is
 * available, letting the user reload into it.
 */
export function PwaManager() {
  const { updateReady, applyUpdate } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  if (!updateReady || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-[#17212b] px-4 py-3 text-white shadow-xl">
        <span className="h-2 w-2 shrink-0 rounded-full bg-tg-green" />
        <p className="flex-1 text-sm">A new version of GhostWire is available.</p>
        <button
          onClick={() => {
            setApplying(true);
            void applyUpdate();
          }}
          disabled={applying}
          className="rounded-xl bg-tg-blue px-3 py-2 text-xs font-semibold text-white hover:bg-tg-blueDark disabled:opacity-60"
        >
          {applying ? "Updating…" : "Update"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg px-2 py-1 text-white/50 hover:bg-white/10"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
