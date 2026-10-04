"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createSession } from "@/lib/session";

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  function start() {
    setBusy(true);
    try {
      createSession(name);
      router.push("/chat");
    } finally {
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
