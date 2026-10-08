"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { InstallButton } from "@/components/InstallButton";
import { AndroidDownload } from "@/components/AndroidDownload";
import { Logo } from "@/components/Logo";
import { useUi } from "@/lib/store";

export default function HomePage() {
  const status = useUi((s) => s.status);
  const joined = useUi((s) => s.joined);
  const router = useRouter();

  useEffect(() => {
    // Only enter the chat once we are actually in the session. A pending joiner
    // is "active" but not joined yet, so bouncing on `active` alone would send
    // them to /chat, which then bounces back here — a redirect loop.
    if (status === "active" && joined) router.replace("/chat");
  }, [status, joined, router]);

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
            <Link
              href="/join?pin=1"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Join with a PIN
            </Link>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <InstallButton variant="ghost" className="w-full sm:w-auto" />
            <AndroidDownload className="w-full sm:w-auto" />
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

        <section className="mt-20">
          <h2 className="text-2xl font-semibold tracking-tight">How to use it — every way to connect</h2>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Pick the mode that fits your situation. The admin device is the anchor; everyone else
            joins. Nothing here needs an account, a server you rent, or the internet.
          </p>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <span className="text-xs font-semibold uppercase tracking-wide text-tg-green">
                Simplest · phones only
              </span>
              <h3 className="mt-2 text-lg font-semibold">Direct QR (offline, no relay)</h3>
              <p className="mt-2 text-sm text-white/60">
                One phone shares its mobile hotspot; others join it. Then pair over WebRTC.
              </p>
              <ol className="mt-4 space-y-2 text-sm text-white/70">
                <li>1. Host phone: <b>Create a session → Direct QR</b> → shows an invite QR.</li>
                <li>2. Joiner: <b>Join a session</b> → scan the invite → shows an answer QR.</li>
                <li>3. Host: scan the answer QR (both phones have cameras) → connected.</li>
                <li>4. Chat directly phone-to-phone. Turn data off; it still works.</li>
              </ol>
              <p className="mt-3 text-xs text-white/40">
                Two scans total, because WebRTC needs a reply and there is no server.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <span className="text-xs font-semibold uppercase tracking-wide text-tg-blue">
                Easiest group join
              </span>
              <h3 className="mt-2 text-lg font-semibold">Relay + 6-digit PIN</h3>
              <p className="mt-2 text-sm text-white/60">
                A relay is a tiny meeting point. One device runs it; everyone else just types a PIN.
              </p>
              <ol className="mt-4 space-y-2 text-sm text-white/70">
                <li>1. On a computer (or together with the app):{" "}
                  <code className="rounded bg-white/10 px-1 text-[11px]">
                    pnpm --filter @ghostwire/relay start -- --port 8787 --serve apps/web/out
                  </code>
                </li>
                <li>2. Host: <b>Create → Relay + PIN</b>. A 6-digit PIN appears (and an optional QR).</li>
                <li>3. Everyone: <b>Join a session → name → Join with a PIN</b> → enter the PIN.</li>
                <li>4. No second QR, no camera. Works on the LAN/hotspot with no internet.</li>
              </ol>
              <p className="mt-3 text-xs text-white/40">
                Open the app over <code>http://&lt;lan-ip&gt;:8787</code> so a <code>ws://</code> relay
                isn’t blocked by the browser.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <span className="text-xs font-semibold uppercase tracking-wide text-tg-purple">
                Works over the internet
              </span>
              <h3 className="mt-2 text-lg font-semibold">Hosted relay (nothing to run)</h3>
              <p className="mt-2 text-sm text-white/60">
                Deploy the relay once with TLS; then the Vercel app joins by PIN from anywhere.
              </p>
              <ol className="mt-4 space-y-2 text-sm text-white/70">
                <li>1. Deploy the relay (Render blueprint in the repo) → get <code>wss://…</code>.</li>
                <li>2. Set <code>NEXT_PUBLIC_RELAY_URL</code> on Vercel and redeploy.</li>
                <li>3. Host: <b>Create → Relay + PIN</b> → share the PIN.</li>
                <li>4. Anyone: <b>Join with a PIN</b>. No relay URL, no QR.</li>
              </ol>
              <p className="mt-3 text-xs text-white/40">
                The relay only forwards opaque encrypted bytes; it can’t read messages.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <h3 className="text-sm font-semibold text-white">No camera on one device?</h3>
              <p className="mt-2 text-sm text-white/60">
                Use the paste flow: the host copies the invite link, the joiner opens it and copies
                the answer link back, and the host pastes it under the invite QR. Same WebRTC link,
                no scans.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <h3 className="text-sm font-semibold text-white">Internet blackout (phones only)</h3>
              <p className="mt-2 text-sm text-white/60">
                Phones can’t run the relay, so use <b>Direct QR over a phone hotspot</b> (two scans).
                A native app (next) adds a <b>Bluetooth mesh</b> and an on-phone relay so a single PIN
                works with no laptop and no hotspot.
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-auto pt-16 text-xs text-white/40">
          Open source under the MIT license. Built for short-lived, high-privacy coordination.
        </footer>
      </div>
    </main>
  );
}
