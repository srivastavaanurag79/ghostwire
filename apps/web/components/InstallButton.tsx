"use client";

import { useState } from "react";
import { useInstallPrompt } from "@/lib/pwa";
import { cx } from "@/lib/utils";

/** PWA install button with an iOS "Add to Home Screen" fallback. */
export function InstallButton({
  variant = "primary",
  className,
}: {
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const { canInstall, installed, isIos, promptInstall } = useInstallPrompt();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [done, setDone] = useState(false);

  if (installed || done) return null;

  const styles =
    variant === "primary"
      ? "bg-tg-blue text-white hover:bg-tg-blueDark"
      : "border border-white/15 bg-white/5 text-white hover:bg-white/10";

  async function onClick() {
    if (canInstall) {
      const accepted = await promptInstall();
      if (accepted) setDone(true);
      return;
    }
    if (isIos) setShowIosHelp(true);
  }

  // If the browser never fired `beforeinstallprompt` and it's not iOS, there is
  // nothing actionable to show.
  if (!canInstall && !isIos) return null;

  return (
    <>
      <button
        onClick={onClick}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-semibold transition",
          styles,
          className,
        )}
      >
        <span aria-hidden>⤓</span>
        Install app
      </button>

      {showIosHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowIosHelp(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#17212b] p-6 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Install GhostWire</h3>
            <ol className="mt-3 space-y-2 text-sm text-white/70">
              <li>
                1. Tap the <span className="font-semibold text-white">Share</span> button in Safari.
              </li>
              <li>
                2. Choose <span className="font-semibold text-white">Add to Home Screen</span>.
              </li>
              <li>
                3. Tap <span className="font-semibold text-white">Add</span>.
              </li>
            </ol>
            <button
              onClick={() => setShowIosHelp(false)}
              className="mt-5 w-full rounded-2xl bg-tg-blue px-4 py-3 text-sm font-semibold text-white hover:bg-tg-blueDark"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
