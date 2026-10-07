"use client";

import {
  fromBase64,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  hash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  toBase64,
  zeroize,
  type KeyPair,
} from "@ghostwire/crypto";
import {
  FILE_CHUNK_BYTES,
  HEARTBEAT_INTERVAL_MS,
  PEER_TIMEOUT_MS,
  PROTOCOL_CAPABILITIES,
  PROTOCOL_VERSION,
  type AdminGrantBody,
  type ChatBody,
  type DelegationCert,
  type FileChunkBody,
  type FileCompleteBody,
  type FileOfferBody,
  type InnerMessage,
  type JoinAcceptBody,
  type JoinRequestBody,
  type MessageBody,
  type MessageType,
  type Peer,
  type Role,
  type RoleToken,
  type TokenIssueBody,
  type TokenRevokeBody,
} from "@ghostwire/protocol";
import { canSend, canIssueRole, issueDelegationCert, issueRoleToken } from "@ghostwire/roles";
import {
  decodeQRPayload,
  encodeQRPayload,
  type QRPayload,
  type SignalingPayload,
} from "@ghostwire/qr";
import { MeshNode, type MeshIdentity } from "@ghostwire/mesh";
import {
  BrowserWebRTCTransport,
  WebSocketTransport,
  type SignalingData,
  type Transport,
  type WebRTCTransport,
} from "@ghostwire/transport";
import { systemMessage, useUi, type NotificationKind, type TransportKind } from "./store";
import { playSound } from "./sound";
import { shortHex, toHex } from "./utils";

/** Max file size we will buffer in memory on the web client. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface IncomingTransfer {
  name: string;
  size: number;
  mime: string;
  hash: Uint8Array;
  chunks: Uint8Array[];
  received: number;
  nextIndex: number;
}

interface Runtime {
  isHost: boolean;
  role: Role;
  sessionId: string;
  sessionKey: Uint8Array;
  adminPubKey: Uint8Array;
  sessionStart: number;
  name: string;
  keyPair: KeyPair;
  token: RoleToken;
  delegations: DelegationCert[];
  adminPrivateKey?: Uint8Array;
  /** Additional admin keys (multi-admin sessions). */
  adminKeys: Uint8Array[];
  transport: Transport;
  mesh: MeshNode;
  transportKind: TransportKind;
  pendingInvites: Map<string, Role>;
  pendingJoinPeers: Map<string, { name: string; pubkey: Uint8Array; requestedRole: Role }>;
  incomingTransfers: Map<string, IncomingTransfer>;
  heartbeat: ReturnType<typeof setInterval> | null;
  joined: boolean;
  relayUrl?: string;
  pin?: string;
}

function randomPin(): string {
  const bytes = randomBytes(4);
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

let runtime: Runtime | null = null;

export function getRuntime(): Runtime | null {
  return runtime;
}

function refreshPeers(): void {
  if (!runtime) return;
  const peers: Peer[] = runtime.mesh.peers.list().filter((p) => {
    return !runtime!.mesh.isRevoked(p.pubkey);
  });
  useUi.getState().setPeers(peers);
}

/** Push a notification to the panel and play its sound. */
function notify(kind: NotificationKind, title: string, body?: string): void {
  useUi.getState().addNotification({
    id: randomUUID(),
    kind,
    title,
    body,
    ts: Date.now(),
    read: false,
  });
  playSound(kind);
}

function handlePeerLeave(peerId: string, peer?: Peer): void {
  refreshPeers();
  // In direct (WebRTC) mode losing a link is permanent until re-pairing, so tell
  // the user. Relay mode reconnects automatically and would be noisy here.
  if (peer && runtime?.transportKind === "webrtc") {
    notify("leave", `${peer.name} disconnected`);
    useUi.getState().addMessage(systemMessage(`${peer.name} disconnected.`));
  }
  void peerId;
}

function startHeartbeat(): void {
  if (!runtime || runtime.heartbeat) return;
  runtime.heartbeat = setInterval(() => {
    if (!runtime || !runtime.joined) return;
    try {
      runtime.mesh.send("ping", { nonce: randomUUID() });
    } catch {
      /* role may not allow it yet */
    }
    const gone = runtime.mesh.peers.prune(PEER_TIMEOUT_MS);
    if (gone.length) refreshPeers();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (runtime?.heartbeat) {
    clearInterval(runtime.heartbeat);
    runtime.heartbeat = null;
  }
}

let connectionTimer: ReturnType<typeof setInterval> | null = null;
let connectionBound = false;
const warnedVersions = new Set<string>();

function computeOnline(): boolean {
  const rt = runtime;
  if (!rt) return true;
  if (rt.transportKind === "relay") {
    return rt.transport instanceof WebSocketTransport ? rt.transport.isOpen : true;
  }
  // Direct WebRTC: a joined non-host with no live links has lost the session;
  // the host simply has no peers yet.
  if (rt.transportKind === "webrtc") {
    if (!rt.isHost && rt.joined) return rt.transport.peerIds.length > 0;
    return typeof navigator === "undefined" || navigator.onLine;
  }
  return true;
}

function updateConnection(): void {
  useUi.getState().setConnection(computeOnline() ? "online" : "offline");
}

/** Track link health so the UI can show a "reconnecting" state. */
function startConnectionWatch(): void {
  if (!connectionBound && typeof window !== "undefined") {
    connectionBound = true;
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
  }
  updateConnection();
  if (!connectionTimer) connectionTimer = setInterval(updateConnection, 4_000);
}

function stopConnectionWatch(): void {
  if (connectionTimer) {
    clearInterval(connectionTimer);
    connectionTimer = null;
  }
}

function announce(): void {
  if (!runtime || !runtime.joined) return;
  const peers = runtime.mesh.peers.list().map((p) => ({
    name: p.name,
    pubkey: p.pubkey,
    role: p.role,
  }));
  runtime.mesh.send("peer_announce", {
    peers,
    pv: PROTOCOL_VERSION,
    caps: [...PROTOCOL_CAPABILITIES],
  });
}

/** Build a self-signed placeholder token so a joiner can emit join_request. */
function placeholderToken(name: string, keyPair: KeyPair, sessionId: string): RoleToken {
  return issueRoleToken({
    sessionId,
    name,
    subjectPubkey: keyPair.publicKey,
    role: "listener",
    issuerPrivateKey: keyPair.privateKey,
    issuerPubkey: keyPair.publicKey,
  });
}

function handleIncoming(inner: InnerMessage, fromPeerId: string): void {
  if (!runtime) return;
  const ui = useUi.getState();

  const existing = runtime.mesh.peers.get(fromPeerId);
  runtime.mesh.peers.upsert(fromPeerId, {
    name: inner.sender.name,
    pubkey: inner.sender.pubkey,
    role: inner.sender.role,
  });
  if (!existing && inner.type !== "join_request" && inner.sender.pubkey.length > 0) {
    notify("join", `${inner.sender.name} joined`);
  }

  switch (inner.type) {
    case "chat": {
      const body = inner.body as ChatBody;
      ui.addMessage({
        id: inner.id,
        ts: inner.ts,
        name: inner.sender.name,
        pubkey: inner.sender.pubkey,
        role: inner.sender.role,
        content: body.text,
      });
      // Only chime for messages that arrive while the tab is in the background,
      // so an active conversation stays quiet.
      if (typeof document !== "undefined" && document.hidden) {
        notify("message", inner.sender.name, body.text);
      }
      break;
    }
    case "join_request": {
      const body = inner.body as JoinRequestBody;
      if (!runtime.isHost && !canIssueRole(runtime.role, "speaker")) break;
      const requestedRole = runtime.pendingInvites.get(fromPeerId) ?? "listener";
      runtime.pendingJoinPeers.set(fromPeerId, {
        name: body.name,
        pubkey: body.pubkey,
        requestedRole,
      });
      ui.addJoinRequest({
        peerId: fromPeerId,
        name: body.name,
        pubkey: body.pubkey,
        requestedRole,
        receivedAt: Date.now(),
      });
      notify("request", `${body.name} wants to join`, "Approve or decline in the requests panel.");
      break;
    }
    case "join_accept": {
      const body = inner.body as JoinAcceptBody;
      if (!timingSafeEqual(body.token.pubkey, runtime.keyPair.publicKey)) break;
      applyToken(body.token, body.delegation);
      break;
    }
    case "token_issue": {
      const body = inner.body as TokenIssueBody;
      if (!timingSafeEqual(body.token.pubkey, runtime.keyPair.publicKey)) break;
      applyToken(body.token);
      break;
    }
    case "token_revoke": {
      const body = inner.body as TokenRevokeBody;
      runtime.mesh.revoke(body.revoke);
      for (const key of body.revoke) {
        const hex = toHex(key);
        const peer = runtime.mesh.peers.list().find((p) => toHex(p.pubkey) === hex);
        if (peer) runtime.mesh.peers.remove(peer.id);
      }
      ui.addMessage(
        systemMessage(`${body.revoke.length} participant(s) were removed by the admin`),
      );
      notify("leave", "Participant removed", "The admin revoked a participant.");
      refreshPeers();
      break;
    }
    case "session_close": {
      ui.addMessage(systemMessage("The session was closed by the admin."));
      notify("error", "Session closed", "The admin ended the session.");
      teardown({ reload: true });
      break;
    }
    case "peer_announce": {
      const body = inner.body as { pv?: number };
      const hex = toHex(inner.sender.pubkey);
      if (body?.pv && body.pv !== PROTOCOL_VERSION && !warnedVersions.has(hex)) {
        warnedVersions.add(hex);
        notify(
          "error",
          "Version mismatch",
          `${inner.sender.name} is on protocol v${body.pv}; you are on v${PROTOCOL_VERSION}.`,
        );
      }
      break;
    }
    case "admin_grant": {
      const body = inner.body as AdminGrantBody;
      if (body?.pubkey?.length) {
        if (!runtime.adminKeys.some((k) => toHex(k) === toHex(body.pubkey))) {
          runtime.adminKeys.push(body.pubkey);
        }
        notify("success", `${body.name ?? "A participant"} is now an admin`);
        ui.addMessage(systemMessage(`${body.name ?? "A participant"} was granted admin.`));
      }
      break;
    }
    case "peer_leave":
    case "ping":
      break;
    case "file_offer":
      void acceptFileOffer(inner.body as FileOfferBody, fromPeerId);
      break;
    case "file_accept":
      /* sender-side; nothing to do until chunks flow */
      break;
    case "file_chunk":
      handleFileChunk(inner.body as FileChunkBody);
      break;
    case "file_complete":
      void finishIncomingFile(inner.body as FileCompleteBody);
      break;
    case "join_reject": {
      ui.setNotice("The host declined this join request.");
      break;
    }
  }

  refreshPeers();
}

function applyToken(token: RoleToken, delegation?: DelegationCert): void {
  if (!runtime) return;
  runtime.token = token;
  runtime.role = token.role;
  runtime.joined = true;
  if (delegation) {
    runtime.delegations.push(delegation);
    runtime.mesh.addDelegation(delegation);
  }
  runtime.mesh.updateIdentity({ token, role: token.role });
  useUi.getState().setRole(token.role);
  useUi.getState().setJoined(true);
  useUi.getState().addMessage(systemMessage(`You are connected as ${token.role}.`));
  notify("success", "Connected", `You joined as ${token.role}.`);
  announce();
  startHeartbeat();
}

function buildMeshIdentity(rt: {
  name: string;
  role: Role;
  token: RoleToken;
  keyPair: KeyPair;
}): MeshIdentity {
  return {
    name: rt.name,
    role: rt.role,
    token: rt.token,
    publicKey: rt.keyPair.publicKey,
    privateKey: rt.keyPair.privateKey,
  };
}

export interface CreateSessionResult {
  sessionId: string;
  inviteFor: (role: Role) => Promise<{ qr: string; link: string }>;
}

export interface CreateSessionOptions {
  /** When provided, the host connects through this WebSocket relay. */
  relayUrl?: string;
}

/** Host a new session. The admin device is the hub every peer connects to. */
export async function createSession(
  name: string,
  options: CreateSessionOptions = {},
): Promise<CreateSessionResult> {
  teardown({ reload: false, silent: true });
  const sessionId = randomUUID();
  const sessionKey = randomBytes(32);
  const adminKeyPair = generateSigningKeyPair();
  const encKeyPair = generateEncryptionKeyPair();
  const sessionStart = Date.now();
  const displayName = name.trim() || "Admin";

  const token = issueRoleToken({
    sessionId,
    name: displayName,
    subjectPubkey: adminKeyPair.publicKey,
    role: "admin",
    issuerPrivateKey: adminKeyPair.privateKey,
    issuerPubkey: adminKeyPair.publicKey,
  });

  const transportKind: TransportKind = options.relayUrl ? "relay" : "webrtc";
  const transport: Transport = options.relayUrl
    ? new WebSocketTransport(options.relayUrl)
    : new BrowserWebRTCTransport();
  if (options.relayUrl) {
    await (transport as WebSocketTransport).open();
  }

  const mesh = new MeshNode({
    transport,
    sessionId,
    sessionKey,
    sessionStart,
    adminPubKey: adminKeyPair.publicKey,
    identity: buildMeshIdentity({
      name: displayName,
      role: "admin",
      token,
      keyPair: adminKeyPair,
    }),
    onMessage: handleIncoming,
    onPeerJoin: () => refreshPeers(),
    onPeerLeave: handlePeerLeave,
  });
  mesh.start();

  runtime = {
    isHost: true,
    role: "admin",
    sessionId,
    sessionKey,
    adminPubKey: adminKeyPair.publicKey,
    sessionStart,
    name: displayName,
    keyPair: adminKeyPair,
    token,
    delegations: [],
    adminPrivateKey: adminKeyPair.privateKey,
    adminKeys: [],
    transport,
    mesh,
    transportKind,
    pendingInvites: new Map(),
    pendingJoinPeers: new Map(),
    incomingTransfers: new Map(),
    heartbeat: null,
    joined: true,
  };
  void encKeyPair;

  const ui = useUi.getState();
  ui.reset();
  ui.activate({
    role: "admin",
    sessionId,
    myName: displayName,
    isHost: true,
    transportKind,
    joined: true,
  });
  ui.addMessage(
    systemMessage(
      transportKind === "relay"
        ? `Session created over relay ${options.relayUrl}. Generate an invite link to bring people in.`
        : "Session created. Share an invite QR to bring people in.",
    ),
  );
  startHeartbeat();
  startConnectionWatch();

  return {
    sessionId,
    inviteFor: async (role: Role) => hostCreateInvite(role),
  };
}

/**
 * Host a session where this device acts as the server: it opens a room on a
 * relay with a 6-digit PIN, and peers join by PIN (no second QR, no camera).
 * Intended to run on the admin's machine / hotspot host.
 */
export async function createRelaySession(
  name: string,
  relayUrl: string,
): Promise<{ pin: string }> {
  teardown({ reload: false, silent: true });
  const sessionId = randomUUID();
  const sessionKey = randomBytes(32);
  const adminKeyPair = generateSigningKeyPair();
  const sessionStart = Date.now();
  const displayName = name.trim() || "Admin";
  const pin = randomPin();

  const token = issueRoleToken({
    sessionId,
    name: displayName,
    subjectPubkey: adminKeyPair.publicKey,
    role: "admin",
    issuerPrivateKey: adminKeyPair.privateKey,
    issuerPubkey: adminKeyPair.publicKey,
  });

  const transport = new WebSocketTransport(relayUrl);
  await transport.open();
  await transport.host(pin, {
    sid: sessionId,
    sk: toBase64(sessionKey),
    apk: toBase64(adminKeyPair.publicKey),
    st: sessionStart,
    role: "listener",
  });

  const mesh = new MeshNode({
    transport,
    sessionId,
    sessionKey,
    sessionStart,
    adminPubKey: adminKeyPair.publicKey,
    identity: buildMeshIdentity({ name: displayName, role: "admin", token, keyPair: adminKeyPair }),
    onMessage: handleIncoming,
    onPeerJoin: () => refreshPeers(),
    onPeerLeave: handlePeerLeave,
  });
  mesh.start();

  runtime = {
    isHost: true,
    role: "admin",
    sessionId,
    sessionKey,
    adminPubKey: adminKeyPair.publicKey,
    sessionStart,
    name: displayName,
    keyPair: adminKeyPair,
    token,
    delegations: [],
    adminPrivateKey: adminKeyPair.privateKey,
    adminKeys: [],
    transport,
    mesh,
    transportKind: "relay",
    pendingInvites: new Map(),
    pendingJoinPeers: new Map(),
    incomingTransfers: new Map(),
    heartbeat: null,
    joined: true,
    relayUrl,
    pin,
  };

  const ui = useUi.getState();
  ui.reset();
  ui.activate({
    role: "admin",
    sessionId,
    myName: displayName,
    isHost: true,
    transportKind: "relay",
    joined: true,
  });
  ui.addMessage(systemMessage(`Session open. Share the PIN ${pin} to let people join.`));
  startHeartbeat();
  startConnectionWatch();

  return { pin };
}

/** Generate a one-time invite: a QR string plus an equivalent shareable link. */
export async function hostCreateInvite(role: Role): Promise<{ qr: string; link: string }> {
  if (!runtime || !runtime.isHost) throw new Error("Not a host");
  const transport = runtime.transport as WebRTCTransport;
  if (typeof transport.createOffer !== "function") throw new Error("Host transport cannot signal");
  const { peerId, signaling } = await transport.createOffer();
  runtime.pendingInvites.set(peerId, role);
  const payload: QRPayload = {
    v: 1,
    sid: runtime.sessionId,
    role,
    sk: runtime.sessionKey,
    apk: runtime.adminPubKey,
    st: runtime.sessionStart,
    sig: signaling as SignalingPayload,
  };
  const qr = encodeQRPayload(payload);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { qr, link: `${origin}/join#${qr}` };
}

/** Host: complete the data channel from the joiner's answer (QR payload or URL). */
export async function hostScanAnswer(text: string): Promise<void> {
  if (!runtime || !runtime.isHost) throw new Error("Not a host");
  let payload: QRPayload;
  try {
    payload = decodeInviteText(text);
  } catch {
    throw new Error(
      "That is not a GhostWire answer code. Paste the ANSWER link from the joiner, not the invite.",
    );
  }
  if (!payload.sig || payload.sig.type !== "answer") {
    throw new Error("That is an invite link, not an answer. Paste the joiner's ANSWER link.");
  }
  const transport = runtime.transport as WebRTCTransport;
  const id = payload.sig.id;
  if (!id) throw new Error("This answer has no connection id");
  const known = transport.peerIds.includes(id);
  if (!known) {
    throw new Error(
      "This answer does not match the current invite. Generate a fresh invite and have the joiner scan it.",
    );
  }
  await transport.acceptAnswer(id, payload.sig as SignalingData);
  useUi
    .getState()
    .addMessage(systemMessage("Answer applied. Waiting for the joiner's request…"));
}

export type JoinOutcome =
  | { mode: "webrtc"; answerQR: string; answerLink: string; role: Role }
  | { mode: "relay" };

/** Accept a raw `GW1:` payload or a URL that contains one in its hash/query. */
export function decodeInviteText(text: string): QRPayload {
  const trimmed = text.trim();
  const index = trimmed.indexOf("GW1:");
  if (index < 0) throw new Error("This QR is not a GhostWire invite");
  return decodeQRPayload(trimmed.slice(index));
}

/**
 * Joiner entry point. Depending on the invite it either performs the WebRTC
 * answer dance (and returns the QR + link to send back) or connects to a relay.
 */
export async function joinFromInvite(text: string, name: string): Promise<JoinOutcome> {
  const payload = decodeInviteText(text);
  if (payload.relay && payload.pin) {
    await setupRelayPinJoiner(payload, name);
    return { mode: "relay" };
  }
  if (payload.relay) {
    await setupRelayJoiner(payload, name);
    return { mode: "relay" };
  }
  if (!payload.sig || payload.sig.type !== "offer") {
    throw new Error("This invite has no connection details");
  }
  const answerQR = await setupWebRTCJoiner(payload, name);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { mode: "webrtc", answerQR, answerLink: `${origin}/join#${answerQR}`, role: payload.role };
}

/** Join a relay room by PIN alone (no QR): the relay hands back the session. */
export async function joinWithPin(
  relayUrl: string,
  pin: string,
  name: string,
): Promise<void> {
  const trimmedRelay = relayUrl.trim();
  if (!/^wss?:\/\//.test(trimmedRelay)) {
    throw new Error("Relay URL must start with ws:// or wss://");
  }
  if (!/^\d{4,8}$/.test(pin.trim())) throw new Error("Enter the numeric PIN");
  teardown({ reload: false, silent: true });
  const displayName = name.trim() || "Guest";
  const keyPair = generateSigningKeyPair();
  const transport = new WebSocketTransport(trimmedRelay);
  await transport.open();
  const config = await transport.join(pin.trim());
  const token = placeholderToken(displayName, keyPair, config.sid);
  createJoinerRuntime({
    payload: {
      v: 1,
      sid: config.sid,
      role: (config.role as Role) ?? "listener",
      sk: fromBase64(config.sk),
      apk: fromBase64(config.apk),
      st: config.st,
    },
    name: displayName,
    keyPair,
    token,
    transport,
    kind: "relay",
  });
  runtime?.mesh.send("join_request", { name: displayName, pubkey: keyPair.publicKey });
}

/** Joiner: join a relay room from an invite link (session material embedded). */
async function setupRelayPinJoiner(payload: QRPayload, name: string): Promise<void> {
  teardown({ reload: false, silent: true });
  const displayName = name.trim() || "Guest";
  const keyPair = generateSigningKeyPair();
  const transport = new WebSocketTransport(payload.relay!);
  await transport.open();
  const config = await transport.join(payload.pin!);
  const sessionKey = payload.sk?.length ? payload.sk : fromBase64(config.sk);
  const adminPubKey = payload.apk?.length ? payload.apk : fromBase64(config.apk);
  const sessionId = payload.sid || config.sid;
  const sessionStart = payload.st || config.st;
  const token = placeholderToken(displayName, keyPair, sessionId);
  createJoinerRuntime({
    payload: {
      ...payload,
      sid: sessionId,
      sk: sessionKey,
      apk: adminPubKey,
      st: sessionStart,
    },
    name: displayName,
    keyPair,
    token,
    transport,
    kind: "relay",
  });
  runtime?.mesh.send("join_request", { name: displayName, pubkey: keyPair.publicKey });
}

async function setupWebRTCJoiner(payload: QRPayload, name: string): Promise<string> {
  teardown({ reload: false, silent: true });
  const displayName = name.trim() || "Guest";
  const keyPair = generateSigningKeyPair();
  const token = placeholderToken(displayName, keyPair, payload.sid);
  const transport = new BrowserWebRTCTransport();
  const { signaling } = await transport.acceptOffer(payload.sig as SignalingData);
  createJoinerRuntime({ payload, name: displayName, keyPair, token, transport, kind: "webrtc" });
  const answer: QRPayload = {
    v: 1,
    sid: payload.sid,
    role: payload.role,
    sk: payload.sk,
    apk: payload.apk,
    st: payload.st,
    sig: signaling as SignalingPayload,
  };
  return encodeQRPayload(answer);
}

async function setupRelayJoiner(payload: QRPayload, name: string): Promise<void> {
  teardown({ reload: false, silent: true });
  const displayName = name.trim() || "Guest";
  const keyPair = generateSigningKeyPair();
  const token = placeholderToken(displayName, keyPair, payload.sid);
  const transport = new WebSocketTransport(payload.relay!);
  await transport.open();
  createJoinerRuntime({ payload, name: displayName, keyPair, token, transport, kind: "relay" });
  runtime?.mesh.send("join_request", { name: displayName, pubkey: keyPair.publicKey });
}

function createJoinerRuntime(params: {
  payload: QRPayload;
  name: string;
  keyPair: KeyPair;
  token: RoleToken;
  transport: Transport;
  kind: TransportKind;
}): void {
  const { payload, name, keyPair, token, transport, kind } = params;
  const mesh = new MeshNode({
    transport,
    sessionId: payload.sid,
    sessionKey: payload.sk,
    sessionStart: payload.st,
    adminPubKey: payload.apk,
    identity: buildMeshIdentity({ name, role: "listener", token, keyPair }),
    onMessage: handleIncoming,
    onPeerJoin: () => {
      refreshPeers();
      if (runtime && !runtime.joined) {
        runtime.mesh.send("join_request", { name, pubkey: keyPair.publicKey });
      }
    },
    onPeerLeave: handlePeerLeave,
  });
  mesh.start();

  runtime = {
    isHost: false,
    role: "listener",
    sessionId: payload.sid,
    sessionKey: payload.sk,
    adminPubKey: payload.apk,
    sessionStart: payload.st,
    name,
    keyPair,
    token,
    delegations: [],
    adminKeys: [],
    transport,
    mesh,
    transportKind: kind,
    pendingInvites: new Map(),
    pendingJoinPeers: new Map(),
    incomingTransfers: new Map(),
    heartbeat: null,
    joined: false,
  };

  const ui = useUi.getState();
  ui.reset();
  ui.activate({
    role: "listener",
    sessionId: payload.sid,
    myName: name,
    isHost: false,
    transportKind: kind,
    joined: false,
  });
  ui.setNotice(
    kind === "relay"
      ? "Connected to the relay. Waiting for the host to approve…"
      : "Hand the answer QR back to the host to complete the link.",
  );
  startConnectionWatch();
}

/** Host: build a relay invite link + QR payload for a chosen role. */
export function hostCreateRelayInvite(role: Role): {
  link: string;
  payload: string;
  pin: string;
} {
  if (!runtime || !runtime.isHost) throw new Error("Not a host");
  if (runtime.transportKind !== "relay" || !runtime.pin || !runtime.relayUrl) {
    throw new Error("This session is not in relay mode");
  }
  const payload: QRPayload = {
    v: 1,
    sid: runtime.sessionId,
    role,
    sk: runtime.sessionKey,
    apk: runtime.adminPubKey,
    st: runtime.sessionStart,
    relay: runtime.relayUrl,
    pin: runtime.pin,
  };
  const encoded = encodeQRPayload(payload);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { link: `${origin}/join#${encoded}`, payload: encoded, pin: runtime.pin };
}

export function approveJoin(peerId: string, role: Role): void {
  if (!runtime) throw new Error("No active session");
  const req = runtime.pendingJoinPeers.get(peerId);
  if (!req) throw new Error("Unknown join request");
  if (!canIssueRole(runtime.role, role)) throw new Error(`Your role cannot grant ${role}`);

  const issuerPrivateKey = runtime.isHost
    ? runtime.adminPrivateKey!
    : runtime.keyPair.privateKey;
  const token = issueRoleToken({
    sessionId: runtime.sessionId,
    name: req.name,
    subjectPubkey: req.pubkey,
    role,
    issuerPrivateKey,
    issuerPubkey: runtime.keyPair.publicKey,
  });

  const body: JoinAcceptBody = { token };
  if (role === "moderator") {
    body.delegation = issueDelegationCert({
      sessionId: runtime.sessionId,
      subjectPubkey: req.pubkey,
      issuerPrivateKey: runtime.isHost ? runtime.adminPrivateKey! : runtime.keyPair.privateKey,
      issuerPubkey: runtime.adminPubKey,
      permissions: ["approve", "revoke"],
    });
  }
  runtime.mesh.send("join_accept", body);
  runtime.pendingJoinPeers.delete(peerId);
  useUi.getState().removeJoinRequest(peerId);
  useUi.getState().addMessage(systemMessage(`${req.name} joined as ${role}.`));
  notify("success", "Approved", `${req.name} joined as ${role}.`);
}

export function rejectJoin(peerId: string): void {
  if (!runtime) return;
  runtime.mesh.send("join_reject", { reason: "not approved" });
  runtime.pendingJoinPeers.delete(peerId);
  useUi.getState().removeJoinRequest(peerId);
}

export function changeRole(pubkey: Uint8Array, role: Role): void {
  if (!runtime || !canIssueRole(runtime.role, role)) throw new Error("Not allowed");
  const token = issueRoleToken({
    sessionId: runtime.sessionId,
    name: runtime.mesh.peers.list().find((p) => timingSafeEqual(p.pubkey, pubkey))?.name ?? "member",
    subjectPubkey: pubkey,
    role,
    issuerPrivateKey: runtime.isHost ? runtime.adminPrivateKey! : runtime.keyPair.privateKey,
    issuerPubkey: runtime.isHost ? runtime.adminPubKey : runtime.keyPair.publicKey,
  });
  runtime.mesh.send("token_issue", { token } satisfies TokenIssueBody);
}

export function revokePeer(pubkey: Uint8Array): void {
  if (!runtime) return;
  runtime.mesh.revoke([pubkey]);
  runtime.mesh.send("token_revoke", { revoke: [pubkey], reason: "revoked by admin" });
  const peer = runtime.mesh.peers.list().find((p) => timingSafeEqual(p.pubkey, pubkey));
  if (peer) runtime.mesh.peers.remove(peer.id);
  refreshPeers();
}

/** Promote a participant to admin (multi-admin sessions). */
export function grantAdmin(pubkey: Uint8Array, name: string): void {
  if (!runtime) return;
  if (runtime.role !== "admin") throw new Error("Only an admin can grant admin");
  const token = issueRoleToken({
    sessionId: runtime.sessionId,
    name,
    subjectPubkey: pubkey,
    role: "admin",
    issuerPrivateKey: runtime.isHost ? runtime.adminPrivateKey! : runtime.keyPair.privateKey,
    issuerPubkey: runtime.isHost ? runtime.adminPubKey : runtime.keyPair.publicKey,
  });
  runtime.mesh.send("token_issue", { token } satisfies TokenIssueBody);
  runtime.mesh.send("admin_grant", { pubkey, name } satisfies AdminGrantBody);
  if (!runtime.adminKeys.some((k) => toHex(k) === toHex(pubkey))) {
    runtime.adminKeys.push(pubkey);
  }
  useUi.getState().addMessage(systemMessage(`${name} is now an admin.`));
}

export function sendChat(text: string): void {
  if (!runtime) return;
  const trimmed = text.trim();
  if (!trimmed || !canSend(runtime.role)) return;
  // Pad to blunt length-correlation of short messages.
  const padding = randomBytes(Math.max(0, 64 - (trimmed.length % 64)));
  runtime.mesh.send("chat", { text: trimmed, padding });
  useUi.getState().addMessage({
    id: randomUUID(),
    ts: Date.now(),
    name: runtime.name,
    pubkey: runtime.keyPair.publicKey,
    role: runtime.role,
    content: trimmed,
  });
}

export function closeSession(): void {
  if (!runtime) return;
  if (runtime.isHost) {
    try {
      runtime.mesh.send("session_close", { reason: "closed by admin" });
    } catch {
      /* ignore */
    }
  }
  useUi.getState().addMessage(systemMessage("Session closed. Wiping all data from memory…"));
  setTimeout(() => teardown({ reload: true }), 400);
}

export function panicWipe(): void {
  teardown({ reload: true });
}

/** Zeroize and drop every session object, then optionally reload the page. */
function teardown(opts: { reload: boolean; silent?: boolean }): void {
  if (!runtime) {
    if (opts.reload && typeof window !== "undefined") window.location.reload();
    return;
  }
  const rt = runtime;
  runtime = null;
  stopHeartbeat();
  stopConnectionWatch();
  try {
    rt.mesh.wipe();
  } catch {
    /* ignore */
  }
  try {
    rt.transport.close();
  } catch {
    /* ignore */
  }
  for (const transfer of rt.incomingTransfers.values()) {
    for (const chunk of transfer.chunks) zeroize(chunk);
  }
  zeroize(rt.sessionKey, rt.keyPair.privateKey, rt.adminPrivateKey);
  for (const cert of rt.delegations) zeroize(cert.signature);
  rt.pendingInvites.clear();
  rt.pendingJoinPeers.clear();
  rt.incomingTransfers.clear();
  warnedVersions.clear();

  useUi.getState().reset();
  if (opts.reload && typeof window !== "undefined") window.location.reload();
}

// ---------------------------------------------------------------------------
// File sharing (chunked, encrypted, in-memory only)
// ---------------------------------------------------------------------------

export async function sendFile(file: File): Promise<void> {
  if (!runtime || !canSend(runtime.role)) throw new Error("You cannot send files");
  if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than the 25 MB in-memory limit");
  const ui = useUi.getState();
  const transferId = randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = hash(bytes);
  ui.addTransfer({
    id: transferId,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    direction: "out",
    progress: 0,
    status: "active",
  });
  runtime.mesh.send("file_offer", {
    transferId,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    hash: digest,
  } satisfies FileOfferBody);

  const total = Math.max(1, Math.ceil(bytes.length / FILE_CHUNK_BYTES));
  for (let index = 0; index < total; index++) {
    const slice = bytes.subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
    runtime.mesh.send("file_chunk", {
      transferId,
      index,
      data: slice.slice(),
    } satisfies FileChunkBody);
    ui.updateTransfer(transferId, { progress: Math.round(((index + 1) / total) * 100) });
    if (index % 32 === 31) await new Promise((r) => setTimeout(r, 0));
  }
  runtime.mesh.send("file_complete", { transferId } satisfies FileCompleteBody);
  ui.updateTransfer(transferId, { progress: 100, status: "done" });
  zeroize(bytes);
}

async function acceptFileOffer(body: FileOfferBody, _fromPeerId: string): Promise<void> {
  if (!runtime) return;
  runtime.incomingTransfers.set(body.transferId, {
    name: body.name,
    size: body.size,
    mime: body.mime,
    hash: body.hash,
    chunks: [],
    received: 0,
    nextIndex: 0,
  });
  useUi.getState().addTransfer({
    id: body.transferId,
    name: body.name,
    size: body.size,
    mime: body.mime,
    direction: "in",
    progress: 0,
    status: "active",
  });
  runtime.mesh.send("file_accept", { transferId: body.transferId });
}

function handleFileChunk(body: FileChunkBody): void {
  if (!runtime) return;
  const transfer = runtime.incomingTransfers.get(body.transferId);
  if (!transfer) return;
  const data = new Uint8Array(body.data);
  transfer.chunks[body.index] = data;
  transfer.received += data.length;
  transfer.nextIndex = Math.max(transfer.nextIndex, body.index + 1);
  const progress = transfer.size > 0 ? Math.round((transfer.received / transfer.size) * 100) : 0;
  useUi.getState().updateTransfer(body.transferId, { progress });
}

async function finishIncomingFile(body: FileCompleteBody): Promise<void> {
  if (!runtime) return;
  const transfer = runtime.incomingTransfers.get(body.transferId);
  if (!transfer) return;
  const total = transfer.chunks.reduce((n, c) => n + (c?.length ?? 0), 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of transfer.chunks) {
    if (!chunk) continue;
    merged.set(chunk, offset);
    offset += chunk.length;
    zeroize(chunk);
  }
  const ok = timingSafeEqual(hash(merged), transfer.hash);
  if (!ok) {
    useUi.getState().updateTransfer(body.transferId, { status: "error" });
    zeroize(merged);
    runtime.incomingTransfers.delete(body.transferId);
    return;
  }
  const url = URL.createObjectURL(new Blob([merged], { type: transfer.mime }));
  useUi.getState().updateTransfer(body.transferId, { status: "done", progress: 100, url });
  runtime.incomingTransfers.delete(body.transferId);
}

export function isRevoked(pubkey: Uint8Array): boolean {
  return runtime?.mesh.isRevoked(pubkey) ?? false;
}

export { MAX_FILE_BYTES };
