"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, Role } from "@ghostwire/protocol";
import { Avatar } from "@/components/Avatar";
import { Logo } from "@/components/Logo";
import { QRCanvas } from "@/components/QRCanvas";
import { QRScanner } from "@/components/QRScanner";
import { RoleBadge } from "@/components/RoleBadge";
import {
  approveJoin,
  closeSession,
  hostCreateInvite,
  hostCreateRelayInvite,
  hostScanAnswer,
  panicWipe,
  rejectJoin,
  revokePeer,
  sendChat,
  sendFile,
  MAX_FILE_BYTES,
} from "@/lib/session";
import { useUi } from "@/lib/store";
import { cx, formatBytes, formatTime, ROLE_META, shortId } from "@/lib/utils";

const INVITE_ROLES: Role[] = ["listener", "speaker", "moderator"];

export default function ChatPage() {
  const router = useRouter();
  const status = useUi((s) => s.status);
  const joined = useUi((s) => s.joined);
  const role = useUi((s) => s.role);
  const sessionId = useUi((s) => s.sessionId);
  const myName = useUi((s) => s.myName);
  const isHost = useUi((s) => s.isHost);
  const transportKind = useUi((s) => s.transportKind);
  const peers = useUi((s) => s.peers);
  const messages = useUi((s) => s.messages);
  const joinRequests = useUi((s) => s.joinRequests);
  const transfers = useUi((s) => s.transfers);
  const notice = useUi((s) => s.notice);

  const [text, setText] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<Role>("listener");
  const [inviteQR, setInviteQR] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [relayLink, setRelayLink] = useState<string | null>(null);
  const [answerScanning, setAnswerScanning] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== "active" || !joined) router.replace("/");
  }, [status, joined, router]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const canSpeak = role === "admin" || role === "moderator" || role === "speaker";
  const canInvite = role === "admin" || role === "moderator";

  const sortedTransfers = useMemo(() => transfers.slice(0, 6), [transfers]);

  async function generateInvite() {
    setInviteError(null);
    try {
      if (transportKind === "relay") {
        const { link } = hostCreateRelayInvite(inviteRole);
        setRelayLink(link);
        setInviteQR(null);
      } else {
        const { qr, link } = await hostCreateInvite(inviteRole);
        setInviteQR(qr);
        setInviteLink(link);
        setAnswerScanning(true);
      }
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Could not generate invite");
    }
  }

  if (status !== "active") {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm gw-muted">No active session.</p>
      </main>
    );
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-chat-dark text-white">
      {/* Sidebar */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 flex w-[320px] max-w-[85vw] flex-col border-r border-white/10 bg-[#17212b] transition-transform md:static md:z-auto md:translate-x-0",
          showSidebar ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <Logo size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">GhostWire session</p>
            <p className="truncate text-xs text-white/50">{sessionId ? shortId(sessionId) : ""}</p>
          </div>
          <button
            className="ml-auto rounded-lg px-2 py-1 text-white/50 hover:bg-white/10 md:hidden"
            onClick={() => setShowSidebar(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3">
          <Avatar name={myName} size={34} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{myName} (you)</p>
            {role && <RoleBadge role={role} />}
          </div>
        </div>

        {canInvite && (
          <button
            onClick={() => setInviteOpen(true)}
            className="mx-4 mb-2 rounded-xl bg-tg-blue px-4 py-3 text-sm font-semibold text-white transition hover:bg-tg-blueDark"
          >
            + Invite someone
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto gw-scroll px-2">
          <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            People · {peers.length}
          </p>
          {peers.length === 0 && (
            <p className="px-3 py-2 text-sm text-white/40">No one else yet.</p>
          )}
          {peers.map((peer) => (
            <div
              key={peer.id}
              className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5"
            >
              <Avatar name={peer.name} pubkey={peer.pubkey} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{peer.name}</p>
                <RoleBadge role={peer.role} />
              </div>
              {canInvite && peer.role !== "admin" && (
                <button
                  title="Revoke"
                  onClick={() => revokePeer(peer.pubkey)}
                  className="rounded-lg px-2 py-1 text-xs text-white/40 hover:bg-tg-red/20 hover:text-tg-red"
                >
                  revoke
                </button>
              )}
            </div>
          ))}

          {canInvite && joinRequests.length > 0 && (
            <div className="mt-3">
              <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-tg-amber">
                Join requests · {joinRequests.length}
              </p>
              {joinRequests.map((req) => (
                <JoinRequestCard key={req.peerId} request={req} />
              ))}
            </div>
          )}

          {sortedTransfers.length > 0 && (
            <div className="mt-3">
              <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                Transfers
              </p>
              {sortedTransfers.map((t) => (
                <div key={t.id} className="rounded-xl px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate pr-2">{t.name}</span>
                    <span className="text-white/50">{t.direction === "in" ? "↓" : "↑"}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cx(
                        "h-full rounded-full",
                        t.status === "error" ? "bg-tg-red" : "bg-tg-blue",
                      )}
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
                    <span>{formatBytes(t.size)}</span>
                    {t.url ? (
                      <a href={t.url} download={t.name} className="text-tg-blue hover:underline">
                        Save
                      </a>
                    ) : (
                      <span>{t.status === "done" ? "done" : `${t.progress}%`}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          {notice && <p className="mb-2 px-2 text-xs text-tg-amber">{notice}</p>}
          <div className="flex gap-2">
            <button
              onClick={panicWipe}
              className="flex-1 rounded-xl border border-tg-red/40 px-3 py-2 text-xs font-semibold text-tg-red hover:bg-tg-red/10"
            >
              Panic wipe
            </button>
            {isHost && (
              <button
                onClick={closeSession}
                className="flex-1 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/5"
              >
                Close session
              </button>
            )}
          </div>
        </div>
      </aside>

      {showSidebar && (
        <button
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setShowSidebar(false)}
          aria-label="Close menu"
        />
      )}

      {/* Chat column */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-[#17212b] px-3 py-3">
          <button
            className="rounded-lg px-2 py-1 text-white/70 hover:bg-white/10 md:hidden"
            onClick={() => setShowSidebar(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Secure mesh</p>
            <p className="truncate text-xs text-white/50">
              {peers.length + 1} connected · end-to-end encrypted
            </p>
          </div>
          <span className="ml-auto rounded-full border border-tg-green/40 px-3 py-1 text-[11px] text-tg-green">
            ● live
          </span>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto gw-scroll gw-chat-bg px-3 py-4">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
            <p className="mb-3 text-center text-xs text-white/40">
              Messages are encrypted with the session key and never stored.
            </p>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} mine={m.name === myName && !m.isSystem} />
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 bg-[#17212b] px-3 py-3">
          <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void sendFile(file).catch((err) => useUi.getState().setNotice(String(err.message ?? err)));
                e.target.value = "";
              }}
            />
            <button
              title={canSpeak ? `Send a file (max ${formatBytes(MAX_FILE_BYTES)})` : "Listeners cannot send"}
              disabled={!canSpeak}
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-white/5 px-4 py-3 text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              📎
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              disabled={!canSpeak}
              placeholder={canSpeak ? "Write an encrypted message…" : "You are a listener — read only"}
              className="max-h-32 min-h-[46px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none ring-tg-blue/40 focus:ring-2 disabled:opacity-50"
            />
            <button
              onClick={() => submit()}
              disabled={!canSpeak || !text.trim()}
              className="rounded-full bg-tg-blue px-5 py-3 text-white transition hover:bg-tg-blueDark disabled:opacity-40"
              aria-label="Send"
            >
              ➤
            </button>
          </div>
        </div>
      </section>

      {inviteOpen && (
        <InviteModal
          role={inviteRole}
          setRole={setInviteRole}
          transportKind={transportKind}
          qr={inviteQR}
          inviteLink={inviteLink}
          relayLink={relayLink}
          error={inviteError}
          scanning={answerScanning}
          onGenerate={generateInvite}
          onScanAnswer={async (t) => {
            try {
              await hostScanAnswer(t);
              setAnswerScanning(false);
              setInviteQR(null);
              setInviteLink(null);
              setInviteOpen(false);
            } catch (e) {
              setInviteError(e instanceof Error ? e.message : "Invalid answer code");
            }
          }}
          onClose={() => {
            setInviteOpen(false);
            setInviteQR(null);
            setInviteLink(null);
            setRelayLink(null);
            setAnswerScanning(false);
          }}
        />
      )}
    </main>
  );

  function submit() {
    if (!text.trim() || !canSpeak) return;
    sendChat(text);
    setText("");
  }
}

function MessageBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  if (message.isSystem) {
    return (
      <p className="my-1 text-center text-xs italic text-white/40">{message.content}</p>
    );
  }
  return (
    <div className={cx("flex animate-fade-in gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && <Avatar name={message.name} pubkey={message.pubkey} size={32} className="mt-auto" />}
      <div className={cx("max-w-[78%] px-3 py-2", mine ? "gw-out gw-bubble-out" : "gw-in gw-bubble-in")}>
        {!mine && (
          <div className="mb-0.5 flex items-center gap-2">
            <span className="text-xs font-semibold text-tg-blue">{message.name}</span>
            <RoleBadge role={message.role} compact />
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        <p className="mt-0.5 text-right text-[10px] text-white/40">{formatTime(message.ts)}</p>
      </div>
    </div>
  );
}

function JoinRequestCard({
  request,
}: {
  request: { peerId: string; name: string; requestedRole: Role };
}) {
  const [role, setRole] = useState<Role>(request.requestedRole);
  return (
    <div className="rounded-xl border border-tg-amber/30 bg-tg-amber/5 p-3">
      <p className="text-sm font-medium">{request.name}</p>
      <p className="text-xs text-white/50">asked to join</p>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className="mt-2 w-full rounded-lg border border-white/15 bg-[#17212b] px-3 py-2 text-xs"
      >
        {INVITE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_META[r].label}
          </option>
        ))}
      </select>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => approveJoin(request.peerId, role)}
          className="flex-1 rounded-lg bg-tg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          Approve
        </button>
        <button
          onClick={() => rejectJoin(request.peerId)}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium hover:bg-white/5"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function InviteModal({
  role,
  setRole,
  transportKind,
  qr,
  inviteLink,
  relayLink,
  error,
  scanning,
  onGenerate,
  onScanAnswer,
  onClose,
}: {
  role: Role;
  setRole: (role: Role) => void;
  transportKind: "webrtc" | "relay" | null;
  qr: string | null;
  inviteLink: string | null;
  relayLink: string | null;
  error: string | null;
  scanning: boolean;
  onGenerate: () => void;
  onScanAnswer: (text: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [big, setBig] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [scanningNow, setScanningNow] = useState(scanning);
  const started = Boolean(qr) || Boolean(relayLink);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div
        className={cx(
          "my-4 w-full rounded-3xl border border-white/10 bg-[#17212b] p-6",
          big ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invite someone</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-white/50 hover:bg-white/10">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-tg-red/40 bg-tg-red/10 px-3 py-2 text-xs text-tg-red">
            {error}
          </p>
        )}

        {!started && (
          <>
            <p className="mt-2 text-sm text-white/60">Choose the role this invite grants.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {INVITE_ROLES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cx(
                    "rounded-xl border px-3 py-3 text-xs font-medium transition",
                    role === r ? "border-tg-blue bg-tg-blue/15" : "border-white/10 hover:bg-white/5",
                  )}
                >
                  <span className={cx("mx-auto mb-1 block h-2 w-2 rounded-full", ROLE_META[r].dot)} />
                  {ROLE_META[r].label}
                </button>
              ))}
            </div>
            <button
              onClick={onGenerate}
              className="mt-4 w-full rounded-2xl bg-tg-blue px-4 py-3 text-sm font-semibold text-white hover:bg-tg-blueDark"
            >
              {transportKind === "relay" ? "Generate invite link" : "Generate invite QR"}
            </button>
          </>
        )}

        {qr && (
          <div className="mt-4 flex flex-col items-center gap-3">
            <QRCanvas value={qr} size={big ? 520 : 340} />
            <button
              onClick={() => setBig((b) => !b)}
              className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/5"
            >
              {big ? "Shrink QR" : "Enlarge QR"}
            </button>

            <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-medium text-white/70">Option A — scan</p>
              <p className="mt-1 text-[11px] text-white/50">
                Have the joiner scan this QR. Then, on this device, either scan their answer QR or
                paste their answer link below.
              </p>
              <button
                onClick={() => setScanningNow((s) => !s)}
                className="mt-2 w-full rounded-xl border border-white/15 px-3 py-2 text-xs font-medium hover:bg-white/5"
              >
                {scanningNow ? "Stop camera" : "Scan the joiner's answer with this camera"}
              </button>
              {scanningNow && (
                <div className="mt-2">
                  <QRScanner
                    onResult={onScanAnswer}
                    active={scanningNow}
                    onError={(msg) => useUi.getState().setNotice(msg)}
                  />
                </div>
              )}
            </div>

            <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-medium text-white/70">Option B — no camera</p>
              <p className="mt-1 text-[11px] text-white/50">
                Send the invite link to the joiner. When they send back an answer link, paste it
                here.
              </p>
              {inviteLink && (
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(inviteLink).then(() => setCopied(true));
                  }}
                  className="mt-2 w-full rounded-xl bg-tg-blue px-3 py-2 text-xs font-semibold text-white hover:bg-tg-blueDark"
                >
                  {copied ? "Invite link copied!" : "Copy invite link"}
                </button>
              )}
              <textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                rows={2}
                placeholder="Paste the joiner's answer link or code…"
                className="mt-2 w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-[11px] outline-none"
              />
              <button
                disabled={!answerText.trim()}
                onClick={() => onScanAnswer(answerText.trim())}
                className="mt-2 w-full rounded-xl bg-tg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                Complete connection
              </button>
            </div>

            <button
              onClick={onGenerate}
              className="w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium hover:bg-white/5"
            >
              Regenerate invite
            </button>
            <button
              onClick={onClose}
              className="w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium hover:bg-white/5"
            >
              Done
            </button>
          </div>
        )}

        {relayLink && (
          <div className="mt-3 flex flex-col items-center gap-3">
            <QRCanvas value={relayLink} size={300} />
            <p className="text-center text-xs text-white/60">
              Share this link. Anyone on your network can open it and request to join.
            </p>
            <input
              readOnly
              value={relayLink}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-[11px]"
            />
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(relayLink).then(() => setCopied(true));
              }}
              className="w-full rounded-2xl bg-tg-blue px-4 py-3 text-sm font-semibold text-white hover:bg-tg-blueDark"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button
              onClick={onClose}
              className="w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium hover:bg-white/5"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
