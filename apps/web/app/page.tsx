"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { InstallButton } from "@/components/InstallButton";
import { Logo } from "@/components/Logo";
import { useUi } from "@/lib/store";

export default function HomePage() {
  const status = useUi((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === "active") router.replace("/chat");
  }, [status, router]);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-chat-dark text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(900px 500px at 15% -10%, rgba(42,171,238,0.35), transparent 60%), radial-gradient(700px 500px at 100% 0%, rgba(135,116,225,0.3), transparent 55%)",
        }}
      />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center gap-3">
          <Logo size={44} />
          <span className="text-xl font-semibold tracking-tight">GhostWire</span>
          <span className="ml-auto rounded-full border border-white/15 px-3 py-1 text-xs text-white/70">
            MIT Licensed
          </span>
        </header>

        <section className="mt-16 max-w-2xl">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-tg-green" />
            No servers · No accounts · No trace
          </p>
          <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Ephemeral mesh chat that lives only in memory.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/70">
            GhostWire connects phones and browsers directly over the local network — Wi-Fi,
            a hotspot, or Bluetooth on native. Messages are end-to-end encrypted, hop between
            devices, and vanish when the session ends.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/create"
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-tg-blue px-6 py-4 text-base font-semibold text-white shadow-lg shadow-tg-blue/25 transition hover:bg-tg-blueDark"
            >
              Create a session
              <span className="transition group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              href="/join"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Join with a QR
            </Link>
          </div>

          <div className="mt-4">
            <InstallButton variant="ghost" className="w-full sm:w-auto" />
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["End-to-end encrypted", "AES-256-GCM per message with keys derived from a single-use session secret."],
            ["Runs offline", "Installable PWA. Works on a local network with no internet at all."],
            ["Roles that matter", "Admin, moderator, speaker, listener — signed, verifiable tokens."],
            ["Wiped on close", "Nothing on disk. Panic wipe zeroizes keys and reloads in one tap."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
            </div>
          ))}
        </section>

        <footer className="mt-auto pt-16 text-xs text-white/40">
          Open source under the MIT license. Built for short-lived, high-privacy coordination.
        </footer>
      </div>
    </main>
  );
}
