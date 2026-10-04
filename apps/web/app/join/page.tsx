"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { QRCanvas } from "@/components/QRCanvas";
import { QRScanner } from "@/components/QRScanner";
import { joinScanInvite } from "@/lib/session";
import { useUi } from "@/lib/store";
import { ROLE_META } from "@/lib/utils";

type Step = "name" | "scan" | "answer";

export default function JoinPage() {
  const router = useRouter();
  const joined = useUi((s) => s.joined);
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [invitedRole, setInvitedRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (joined) router.push("/chat");
  }, [joined, router]);

  const onScan = useCallback(
    async (text: string) => {
      if (step !== "scan") return;
      setScanning(false);
      try {
        const result = await joinScanInvite(text, name);
        setAnswer(result.answerQR);
        setInvitedRole(result.role);
        setStep("answer");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that invite");
        setScanning(true);
      }
    },
    [step, name],
  );

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
            />
          </div>
          <button
            onClick={() => {
              setError(null);
              setStep("scan");
              setScanning(true);
            }}
            className="rounded-2xl bg-tg-blue px-6 py-4 text-base font-semibold text-white transition hover:bg-tg-blueDark"
          >
            Scan invite QR
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
            <p className="text-sm font-medium">Show this answer QR to the host</p>
            <p className="mt-1 text-xs gw-muted">
              Requested role:{" "}
              <span className="font-medium">
                {invitedRole ? ROLE_META[invitedRole as keyof typeof ROLE_META].label : "Listener"}
              </span>
            </p>
          </div>
          <QRCanvas value={answer} />
          <p className="flex items-center gap-2 text-sm gw-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-tg-amber" />
            Waiting for the host to approve…
          </p>
        </div>
      )}
    </main>
  );
}
