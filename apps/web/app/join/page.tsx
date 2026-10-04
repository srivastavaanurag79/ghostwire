"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { QRCanvas } from "@/components/QRCanvas";
import { QRScanner } from "@/components/QRScanner";
import { decodeInviteText, joinFromInvite } from "@/lib/session";
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
          <button
            onClick={continueWithName}
            className="rounded-2xl bg-tg-blue px-6 py-4 text-base font-semibold text-white transition hover:bg-tg-blueDark"
          >
            {linkInvite.current ? "Join session" : "Scan invite QR"}
          </button>
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
          <QRCanvas value={answer} size={280} />
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
          <p className="flex items-center gap-2 text-sm gw-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-tg-amber" />
            Waiting for the host to connect and approve…
          </p>
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
