"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InstallButton } from "@/components/InstallButton";
import { Logo } from "@/components/Logo";
import { panicWipe } from "@/lib/session";

export default function SettingsPage() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("gw:theme", next ? "dark" : "light");
    } catch {
      /* preferences only; safe to ignore */
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <Link href="/" className="flex items-center gap-2 text-sm gw-muted hover:opacity-80">
        ← Home
      </Link>
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm gw-muted">Privacy, appearance and the panic switch.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <InstallButton variant="primary" className="w-full" />
        <p className="text-xs gw-muted">
          Install GhostWire as an app for a full-screen, offline-capable experience.
        </p>
      </div>

      <div className="divide-y divide-[color:var(--gw-border)] rounded-2xl border gw-border gw-panel">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm hover:bg-black/5"
        >
          <span>Appearance</span>
          <span className="gw-muted">{dark ? "Dark" : "Light"}</span>
        </button>
        <div className="flex items-center justify-between px-5 py-4 text-sm">
          <span>Session storage</span>
          <span className="gw-muted">Memory only</span>
        </div>
        <div className="flex items-center justify-between px-5 py-4 text-sm">
          <span>Telemetry</span>
          <span className="gw-muted">None</span>
        </div>
      </div>

      <button
        onClick={panicWipe}
        className="rounded-2xl bg-tg-red px-6 py-4 text-base font-semibold text-white transition hover:opacity-90"
      >
        Panic wipe
      </button>
      <p className="text-xs gw-muted">
        Panic wipe zeroizes every session key in memory, closes all peer links and reloads the
        page. Nothing is ever written to disk, so there is nothing left to recover.
      </p>

      <div className="mt-auto text-xs gw-muted">
        GhostWire · MIT License · No servers, no accounts, no trace.
      </div>
    </main>
  );
}
