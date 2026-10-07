"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { QRCanvas } from "@/components/QRCanvas";
import { QRScanner } from "@/components/QRScanner";
import { decodeInviteText, joinFromInvite, joinWithPin } from "@/lib/session";
import { useUi } from "@/lib/store";
import { ROLE_META } from "@/lib/utils";
import type { Role } from "@ghostwire/protocol";

type Step = "name" | "scan" | "answer" | "waiting";

export default function JoinPage() {
  const router = useRouter();
  const joined = useUi((s) => s.joined);
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerLink, setAnswerLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrBig, setQrBig] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [relayInput, setRelayInput] = useState(process.env.NEXT_PUBLIC_RELAY_URL ?? "");
  const [pinInput, setPinInput] = useState("");
  const [working, setWorking] = useState(false);
  const [isHttps, setIsHttps] = useState(false);

  useEffect(() => {
    setIsHttps(typeof window !== "undefined" && window.location.protocol === "https:");
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("pin") === "1" && !window.location.hash) setPinMode(true);
      if (!process.env.NEXT_PUBLIC_RELAY_URL && window.location.protocol === "http:") {
        setRelayInput((current) => current || `ws://${window.location.host}`);
      }
    }
  }, []);
  const [invitedRole, setInvitedRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const linkInvite = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const text = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (text.includes("GW1:")) linkInvite.current = text;
    }
  }, []);

  useEffect(() => {
    if (joined) router.push("/chat");
  }, [joined, router]);

  const runJoin = useCallback(
    async (text: string, displayName: string) => {
      const payload = decodeInviteText(text);
      setInvitedRole(payload.role);
      const outcome = await joinFromInvite(text, displayName);
      if (outcome.mode === "webrtc") {
        setAnswer(outcome.answerQR);
        setAnswerLink(outcome.answerLink);
        setStep("answer");
      } else {
        setStep("waiting");
      }
    },
    [],
  );

  const onScan = useCallback(
    async (text: string) => {
      if (step !== "scan") return;
      setScanning(false);
      setError(null);
      try {
        await runJoin(text, name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that invite");
        setScanning(true);
      }
    },
    [step, name, runJoin],
  );

  async function continueWithName() {
    setError(null);
    if (linkInvite.current) {
      setStep("waiting");
      try {
        await runJoin(linkInvite.current, name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not join");
        setStep("name");
      }
      return;
    }
    setStep("scan");
    setScanning(true);
  }

  async function startPinJoin() {
    setError(null);
    setWorking(true);
    try {
      await joinWithPin(relayInput, pinInput, name);
      setStep("waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join with that PIN");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <Link href="/" className="flex items-center gap-2 text-sm gw-muted hover:opacity-80">
        ← Back
      </Link>
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <div>
          <h1 className="text-2xl font-semibold">Join a session</h1>
          <p className="text-sm gw-muted">Scan an invite, show your answer back.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-tg-red/40 bg-tg-red/10 px-4 py-3 text-sm text-tg-red">
          {error}
        </div>
      )}

      {step === "name" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border gw-border gw-panel p-5">
            <label className="text-sm font-medium" htmlFor="join-name">
              Your display name
            </label>
            <input
              id="join-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Field team 2"
              maxLength={32}
              className="mt-2 w-full rounded-xl border gw-border bg-transparent px-4 py-3 text-base outline-none ring-tg-blue/40 focus:ring-2"
              onKeyDown={(e) => e.key === "Enter" && continueWithName()}
            />
            {linkInvite.current && (
              <p className="mt-3 text-xs text-tg-green">Invite link detected — ready to join.</p>
            )}
          </div>

          {!pinMode && (
            <>
              <button
                onClick={continueWithName}
                className="rounded-2xl bg-tg-blue px-6 py-4 text-base font-semibold text-white transition hover:bg-tg-blueDark"
              >
                {linkInvite.current ? "Join session" : "Scan invite QR"}
              </button>
              {!linkInvite.current && (
                <button
                  onClick={() => {
                    setError(null);
                    setPinMode(true);
                  }}
                  className="rounded-2xl border gw-border px-6 py-3 text-sm font-medium gw-muted hover:opacity-80"
                >
                  Join with a PIN instead
                </button>
              )}
            </>
          )}

          {pinMode && (
            <div className="flex flex-col gap-3 rounded-2xl border gw-border gw-panel p-5">
              {!process.env.NEXT_PUBLIC_RELAY_URL && (
                <div>
                  <label className="text-sm font-medium" htmlFor="relay-url">
                    Relay URL
                  </label>
                  <input
                    id="relay-url"
                    value={relayInput}
                    onChange={(e) => setRelayInput(e.target.value)}
                    placeholder="ws://192.168.1.10:8787"
                    className="mt-2 w-full rounded-xl border gw-border bg-transparent px-4 py-3 text-base outline-none ring-tg-blue/40 focus:ring-2"
                  />
                </div>
              )}
              {process.env.NEXT_PUBLIC_RELAY_URL && (
                <p className="text-xs gw-muted">
                  Relay: {process.env.NEXT_PUBLIC_RELAY_URL.replace(/^wss?:\/\//, "")}
                </p>
              )}
              <div>
                <label className="text-sm font-medium" htmlFor="pin">
                  Session PIN
                </label>
                <input
                  id="pin"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  placeholder="6-digit PIN"
                  className="mt-2 w-full rounded-xl border gw-border bg-transparent px-4 py-3 text-center text-2xl tracking-[0.3em] outline-none ring-tg-blue/40 focus:ring-2"
                />
              </div>
              <button
                onClick={startPinJoin}
                disabled={working || !pinInput || !relayInput}
                className="mt-1 rounded-2xl bg-tg-blue px-6 py-4 text-base font-semibold text-white transition hover:bg-tg-blueDark disabled:opacity-50"
              >
                {working ? "Connecting…" : "Join session"}
              </button>
              {isHttps && relayInput.startsWith("ws://") && (
                <p className="rounded-xl border border-tg-amber/40 bg-tg-amber/10 px-3 py-2 text-xs text-tg-amber">
                  An HTTPS page cannot open a <code>ws://</code> relay. Open the app over HTTP from
                  the relay (<code>http://&lt;lan-ip&gt;:8787</code>) instead.
                </p>
              )}
              <button
                onClick={() => setPinMode(false)}
                className="text-xs gw-muted hover:opacity-80"
              >
                Back
              </button>
            </div>
          )}
        </div>
      )}

      {step === "scan" && (
        <div className="flex flex-col gap-4">
          <QRScanner onResult={onScan} onError={() => setScanning(false)} active={scanning} />
          <button
            onClick={() => setStep("name")}
            className="rounded-2xl border gw-border px-6 py-3 text-sm font-medium gw-muted hover:opacity-80"
          >
            Cancel
          </button>
        </div>
      )}

      {step === "answer" && answer && (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl border gw-border gw-panel p-4 text-center">
            <p className="text-sm font-medium">Send this answer back to the host</p>
            <p className="mt-1 text-xs gw-muted">
              Requested role:{" "}
              <span className="font-medium">
                {invitedRole ? ROLE_META[invitedRole].label : "Listener"}
              </span>
            </p>
          </div>
          <QRCanvas value={answer} size={320} />
          <div className="flex w-full gap-2">
            <button
              onClick={() => setQrBig(true)}
              className="flex-1 rounded-xl border gw-border px-4 py-3 text-sm font-medium hover:opacity-80"
            >
              Show fullscreen QR
            </button>
          </div>
          {answerLink && (
            <div className="w-full rounded-2xl border gw-border gw-panel p-3">
              <p className="text-xs gw-muted">
                No camera on the host? Send them this answer link instead:
              </p>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(answerLink).then(() => setCopied(true));
                }}
                className="mt-2 w-full rounded-xl bg-tg-blue px-4 py-3 text-sm font-semibold text-white hover:bg-tg-blueDark"
              >
                {copied ? "Answer link copied!" : "Copy answer link"}
              </button>
            </div>
          )}
          <p className="flex items-center gap-2 text-center text-sm gw-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-tg-amber" />
            Keep this page open in the foreground until the host connects.
          </p>
        </div>
      )}

      {qrBig && answer && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-4"
          onClick={() => setQrBig(false)}
        >
          <QRCanvas value={answer} size={Math.min(640, Math.round((typeof window !== "undefined" ? window.innerWidth : 360) * 0.92))} />
          <p className="text-sm text-white/70">Tap anywhere to close</p>
        </div>
      )}

      {step === "waiting" && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border gw-border gw-panel p-8 text-center">
          <Logo size={56} className="animate-pulse" />
          <p className="text-sm font-medium">Request sent to the host</p>
          <p className="text-xs gw-muted">
            Requested role:{" "}
            <span className="font-medium">
              {invitedRole ? ROLE_META[invitedRole].label : "Listener"}
            </span>
          </p>
          <p className="text-xs gw-muted">You will enter the chat as soon as you are approved.</p>
        </div>
      )}
    </main>
  );
}
