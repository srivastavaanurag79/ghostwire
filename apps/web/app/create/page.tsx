"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createRelaySession, createSession } from "@/lib/session";
import { cx } from "@/lib/utils";

type Mode = "webrtc" | "relay";

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("webrtc");
  const [relayUrl, setRelayUrl] = useState("ws://192.168.1.10:8787");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isHttps, setIsHttps] = useState(false);

  useEffect(() => {
    setIsHttps(typeof window !== "undefined" && window.location.protocol === "https:");
  }, []);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "relay") {
        if (!/^wss?:\/\//.test(relayUrl.trim())) {
          throw new Error("Relay URL must start with ws:// or wss://");
        }
        await createRelaySession(name, relayUrl.trim());
      } else {
        await createSession(name);
      }
      router.push("/chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the session");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <Link href="/" className="flex items-center gap-2 text-sm gw-muted hover:opacity-80">
        ← Back
      </Link>
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <div>
          <h1 className="text-2xl font-semibold">Create a session</h1>
          <p className="text-sm gw-muted">You are the admin. This device anchors the mesh.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-tg-red/40 bg-tg-red/10 px-4 py-3 text-sm text-tg-red">
          {error}
        </div>
      )}

      <div className="rounded-2xl border gw-border gw-panel p-5">
        <label className="text-sm font-medium" htmlFor="name">
          Your display name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Night Shift lead"
          maxLength={32}
          className="mt-2 w-full rounded-xl border gw-border bg-transparent px-4 py-3 text-base outline-none ring-tg-blue/40 focus:ring-2"
          onKeyDown={(e) => e.key === "Enter" && start()}
        />
        <p className="mt-3 text-xs gw-muted">
          Names are visible only to people in this session. Nothing is stored after it ends.
        </p>
      </div>

      <div className="rounded-2xl border gw-border gw-panel p-5">
        <p className="text-sm font-medium">Connection</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("webrtc")}
            className={cx(
              "rounded-xl border px-3 py-3 text-left text-xs transition",
              mode === "webrtc" ? "border-tg-blue bg-tg-blue/15" : "border-white/10 hover:bg-white/5",
            )}
          >
            <span className="block text-sm font-semibold">Direct QR</span>
            <span className="gw-muted">Peer-to-peer over the local network. No setup.</span>
          </button>
          <button
            onClick={() => setMode("relay")}
            className={cx(
              "rounded-xl border px-3 py-3 text-left text-xs transition",
              mode === "relay" ? "border-tg-blue bg-tg-blue/15" : "border-white/10 hover:bg-white/5",
            )}
          >
            <span className="block text-sm font-semibold">Relay + PIN</span>
            <span className="gw-muted">Join with a 6-digit PIN. No second QR.</span>
          </button>
        </div>

        {mode === "relay" && (
          <div className="mt-4">
            <label className="text-xs font-medium gw-muted" htmlFor="relay">
              Relay WebSocket URL (your device / LAN host)
            </label>
            <input
              id="relay"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="ws://192.168.1.10:8787"
              className="mt-1 w-full rounded-xl border gw-border bg-transparent px-4 py-3 text-sm outline-none ring-tg-blue/40 focus:ring-2"
            />
            <p className="mt-2 text-xs gw-muted">
              Run it on this machine or the hotspot host:{" "}
              <code className="rounded bg-white/10 px-1">
                pnpm --filter @ghostwire/relay start --port 8787 --serve apps/web/out
              </code>
              . Use your LAN IP (not localhost).
            </p>
            {isHttps && (
              <p className="mt-2 rounded-xl border border-tg-amber/40 bg-tg-amber/10 px-3 py-2 text-xs text-tg-amber">
                You opened this over HTTPS, so the browser blocks <code>ws://</code> relay URLs
                (mixed content). For relay + PIN, open the app over HTTP from the relay itself:
                <code className="mx-1 rounded bg-white/10 px-1">http://&lt;lan-ip&gt;:8787</code>.
              </p>
            )}
          </div>
        )}
      </div>

      <button
        onClick={start}
        disabled={busy}
        className="rounded-2xl bg-tg-blue px-6 py-4 text-base font-semibold text-white transition hover:bg-tg-blueDark disabled:opacity-60"
      >
        {busy ? "Creating…" : "Create session"}
      </button>
    </main>
  );
}
