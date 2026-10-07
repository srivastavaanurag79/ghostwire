import {
  fromBase64,
  generateSigningKeyPair,
  hash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  toBase64,
  zeroize,
  type KeyPair,
} from "@ghostwire/crypto";
import { MeshNode, type MeshIdentity } from "@ghostwire/mesh";
import { canSend, issueDelegationCert, issueRoleToken } from "@ghostwire/roles";
import {
  FILE_CHUNK_BYTES,
  type ChatBody,
  type ChatMessage,
  type DelegationCert,
  type FileChunkBody,
  type FileCompleteBody,
  type FileOfferBody,
  type InnerMessage,
  type JoinAcceptBody,
  type JoinRequestBody,
  type Peer,
  type Role,
  type RoleToken,
  type TokenRevokeBody,
} from "@ghostwire/protocol";
import { WebSocketTransport, type Transport } from "@ghostwire/transport";
import { decodeQRPayload, encodeQRPayload, type QRPayload } from "@ghostwire/qr";
import { BleTransport } from "./transports/ble";
import { createDualRoleAdapter } from "./transports/ble-peripheral";
import { startLocalRelay, type LocalRelayHandle } from "./server/local-relay";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

interface NativeTransfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "active" | "done" | "error";
  direction: "in" | "out";
  /** local file uri once received */
  url?: string;
}

interface IncomingFile {
  name: string;
  size: number;
  mime: string;
  hash: Uint8Array;
  chunks: Uint8Array[];
  received: number;
}

export interface NativeState {
  screen: "home" | "active";
  role: Role | null;
  sessionId: string | null;
  name: string;
  isHost: boolean;
  pin: string | null;
  messages: ChatMessage[];
  peers: Peer[];
  joinRequests: Array<{ peerId: string; name: string; pubkey: Uint8Array; requestedRole: Role }>;
  transfers: NativeTransfer[];
  notice: string | null;
  transport: "relay" | "ble" | null;
  bleQr: string | null;
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
  transport: Transport;
  mesh: MeshNode;
  pendingJoinPeers: Map<string, { name: string; pubkey: Uint8Array; requestedRole: Role }>;
  incoming: Map<string, IncomingFile>;
  localRelay?: LocalRelayHandle;
}

const initialState: NativeState = {
  screen: "home",
  role: null,
  sessionId: null,
  name: "",
  isHost: false,
  pin: null,
  messages: [],
  peers: [],
  joinRequests: [],
  transfers: [],
  notice: null,
  transport: null,
  bleQr: null,
};

function pinCode(): string {
  const bytes = randomBytes(4);
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Native session engine. Transport-agnostic: today it uses the WebSocket relay
 * (join by 6-digit PIN); the Bluetooth LE transport plugs in the same way.
 */
export class NativeSession {
  private runtime: Runtime | null = null;
  private state: NativeState = { ...initialState };
  private listeners = new Set<(state: NativeState) => void>();

  getState = (): NativeState => this.state;

  subscribe = (listener: (state: NativeState) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<NativeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private identity(rt: {
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

  private onMessage = (inner: InnerMessage, fromPeerId: string): void => {
    const rt = this.runtime;
    if (!rt) return;
    rt.mesh.peers.upsert(fromPeerId, {
      name: inner.sender.name,
      pubkey: inner.sender.pubkey,
      role: inner.sender.role,
    });

    if (inner.type === "chat") {
      const body = inner.body as ChatBody;
      this.set({
        messages: [
          ...this.state.messages,
          {
            id: inner.id,
            ts: inner.ts,
            name: inner.sender.name,
            pubkey: inner.sender.pubkey,
            role: inner.sender.role,
            content: body.text,
          },
        ],
      });
    } else if (inner.type === "join_request") {
      if (!rt.isHost && !canSend(rt.role)) return;
      const body = inner.body as JoinRequestBody;
      const requestedRole: Role = "listener";
      rt.pendingJoinPeers.set(fromPeerId, {
        name: body.name,
        pubkey: body.pubkey,
        requestedRole,
      });
      if (!this.state.joinRequests.some((r) => r.peerId === fromPeerId)) {
        this.set({
          joinRequests: [
            ...this.state.joinRequests,
            { peerId: fromPeerId, name: body.name, pubkey: body.pubkey, requestedRole },
          ],
        });
      }
    } else if (inner.type === "join_accept") {
      const body = inner.body as JoinAcceptBody;
      if (!timingSafeEqual(body.token.pubkey, rt.keyPair.publicKey)) return;
      rt.token = body.token;
      rt.role = body.token.role;
      if (body.delegation) {
        rt.delegations.push(body.delegation);
        rt.mesh.addDelegation(body.delegation);
      }
      rt.mesh.updateIdentity({ token: body.token, role: body.token.role });
      this.set({ role: body.token.role });
      this.system(`You are connected as ${body.token.role}.`);
    } else if (inner.type === "token_revoke") {
      const body = inner.body as TokenRevokeBody;
      rt.mesh.revoke(body.revoke);
      this.system(`${body.revoke.length} participant(s) were removed.`);
    } else if (inner.type === "session_close") {
      this.system("The session was closed by the admin.");
      this.panicWipe();
    } else if (inner.type === "file_offer") {
      const body = inner.body as FileOfferBody;
      rt.incoming.set(body.transferId, {
        name: body.name,
        size: body.size,
        mime: body.mime,
        hash: body.hash,
        chunks: [],
        received: 0,
      });
      this.set({
        transfers: [
          {
            id: body.transferId,
            name: body.name,
            size: body.size,
            progress: 0,
            status: "active",
            direction: "in",
          },
          ...this.state.transfers,
        ],
      });
      rt.mesh.send("file_accept", { transferId: body.transferId });
    } else if (inner.type === "file_chunk") {
      const body = inner.body as FileChunkBody;
      const file = rt.incoming.get(body.transferId);
      if (file) {
        const data = new Uint8Array(body.data);
        file.chunks[body.index] = data;
        file.received += data.length;
        const progress = file.size > 0 ? Math.round((file.received / file.size) * 100) : 0;
        this.updateTransfer(body.transferId, { progress });
      }
    } else if (inner.type === "file_complete") {
      void this.finishIncomingFile((inner.body as FileCompleteBody).transferId);
    }

    this.set({ peers: rt.mesh.peers.list() });
  };

  private system(content: string): void {
    this.set({
      messages: [
        ...this.state.messages,
        {
          id: `sys-${Date.now()}`,
          ts: Date.now(),
          name: "system",
          pubkey: new Uint8Array(0),
          role: "listener",
          content,
          isSystem: true,
        },
      ],
    });
  }

  private async openRelaySession(
    name: string,
    relayUrl: string,
    opts: { host: boolean; pin?: string },
  ): Promise<void> {
    this.teardown();
    const keyPair = generateSigningKeyPair();
    const displayName = name.trim() || (opts.host ? "Admin" : "Guest");
    const pin = opts.pin ?? pinCode();

    const transport = new WebSocketTransport(relayUrl);
    await transport.open();

    let sessionId = randomUUID();
    let sessionKey = randomBytes(32);
    let adminPubKey = keyPair.publicKey;
    let sessionStart = Date.now();
    let role: Role = "admin";
    let token: RoleToken;

    if (opts.host) {
      token = issueRoleToken({
        sessionId,
        name: displayName,
        subjectPubkey: keyPair.publicKey,
        role,
        issuerPrivateKey: keyPair.privateKey,
        issuerPubkey: keyPair.publicKey,
      });
      await transport.host(pin, {
        sid: sessionId,
        sk: toBase64(sessionKey),
        apk: toBase64(adminPubKey),
        st: sessionStart,
        role: "listener",
      });
    } else {
      const config = await transport.join(pin);
      sessionId = config.sid;
      sessionKey = fromBase64(config.sk);
      adminPubKey = fromBase64(config.apk);
      sessionStart = config.st;
      role = "listener";
      token = issueRoleToken({
        sessionId,
        name: displayName,
        subjectPubkey: keyPair.publicKey,
        role,
        issuerPrivateKey: keyPair.privateKey,
        issuerPubkey: keyPair.publicKey,
      });
    }

    const runtime: Runtime = {
      isHost: opts.host,
      role,
      sessionId,
      sessionKey,
      adminPubKey,
      sessionStart,
      name: displayName,
      keyPair,
      token,
      delegations: [],
      adminPrivateKey: opts.host ? keyPair.privateKey : undefined,
      transport,
      mesh: null as unknown as MeshNode,
      pendingJoinPeers: new Map(),
      incoming: new Map(),
    };

    runtime.mesh = new MeshNode({
      transport,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey,
      identity: this.identity({ name: displayName, role, token, keyPair }),
      onMessage: this.onMessage,
      onPeerJoin: () => this.set({ peers: runtime.mesh.peers.list() }),
      onPeerLeave: () => this.set({ peers: runtime.mesh.peers.list() }),
    });
    runtime.mesh.start();

    this.runtime = runtime;
    this.set({
      screen: "active",
      role,
      sessionId,
      name: displayName,
      isHost: opts.host,
      pin,
      transport: "relay",
      peers: [],
      messages: [],
      joinRequests: [],
      notice: null,
    });
    this.system(opts.host ? `Session open. PIN ${pin}.` : "Connected. Waiting for approval…");

    if (!opts.host) {
      runtime.mesh.send("join_request", { name: displayName, pubkey: keyPair.publicKey });
    }
  }

  createRelay = (name: string, relayUrl: string): Promise<void> =>
    this.openRelaySession(name, relayUrl, { host: true });

  joinRelay = (name: string, relayUrl: string, pin: string): Promise<void> =>
    this.openRelaySession(name, relayUrl, { host: false, pin });

  /**
   * Join from a scanned/imported invite. Understands:
   *  - web relay invite (URL or `GW1:` with `relay` + `pin`) → joins over WebSocket
   *  - Bluetooth invite (`GW1:` with session material, no relay/sig) → BLE mesh
   *  - direct WebRTC invite (`sig`) → not supported here (explains why)
   */
  joinFromQr = async (text: string, name: string): Promise<void> => {
    const index = text.indexOf("GW1:");
    if (index < 0) throw new Error("Not a GhostWire invite");
    const payload = decodeQRPayload(text.trim().slice(index));
    if (payload.relay) {
      if (!payload.pin) throw new Error("This relay invite is missing its PIN");
      await this.openRelaySession(name, payload.relay, { host: false, pin: payload.pin });
      return;
    }
    if (payload.sig) {
      throw new Error(
        "This is a direct WebRTC invite. Ask the host to use Relay + PIN, or join from the web app.",
      );
    }
    await this.joinBle(text.trim(), name);
  };

  /**
   * Host a session entirely on this phone: start the on-phone relay and connect
   * to it over localhost. Others on the same Wi-Fi/hotspot join with the PIN.
   */
  hostOnPhone = async (name: string): Promise<void> => {
    const relay = await startLocalRelay({ port: 8787 });
    try {
      await this.openRelaySession(name, `ws://127.0.0.1:${relay.port}`, { host: true });
    } catch (e) {
      await relay.close();
      throw e;
    }
    if (this.runtime) this.runtime.localRelay = relay;
    this.system(
      `Hosting on this phone. Others on your network join with PIN ${this.state.pin}.`,
    );
  };

  /**
   * Start a Bluetooth mesh session (no internet, no hotspot, no relay). Returns
   * the invite payload to show as a QR — a single QR is all that is needed
   * because BLE has no offer/answer handshake.
   */
  createBle = async (name: string): Promise<string> => {
    this.teardown();
    const sessionId = randomUUID();
    const sessionKey = randomBytes(32);
    const keyPair = generateSigningKeyPair();
    const sessionStart = Date.now();
    const displayName = name.trim() || "Admin";
    const token = issueRoleToken({
      sessionId,
      name: displayName,
      subjectPubkey: keyPair.publicKey,
      role: "admin",
      issuerPrivateKey: keyPair.privateKey,
      issuerPubkey: keyPair.publicKey,
    });

    const transport = new BleTransport(createDualRoleAdapter());
    await transport.start();

    const runtime: Runtime = {
      isHost: true,
      role: "admin",
      sessionId,
      sessionKey,
      adminPubKey: keyPair.publicKey,
      sessionStart,
      name: displayName,
      keyPair,
      token,
      delegations: [],
      adminPrivateKey: keyPair.privateKey,
      transport,
      mesh: null as unknown as MeshNode,
      pendingJoinPeers: new Map(),
      incoming: new Map(),
    };
    runtime.mesh = new MeshNode({
      transport,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey: keyPair.publicKey,
      identity: this.identity({ name: displayName, role: "admin", token, keyPair }),
      onMessage: this.onMessage,
      onPeerJoin: () => this.set({ peers: runtime.mesh.peers.list() }),
      onPeerLeave: () => this.set({ peers: runtime.mesh.peers.list() }),
    });
    runtime.mesh.start();
    this.runtime = runtime;

    const payload: QRPayload = {
      v: 1,
      sid: sessionId,
      role: "listener",
      sk: sessionKey,
      apk: keyPair.publicKey,
      st: sessionStart,
    };
    const bleQr = encodeQRPayload(payload);
    this.set({
      screen: "active",
      role: "admin",
      sessionId,
      name: displayName,
      isHost: true,
      pin: null,
      transport: "ble",
      bleQr,
      peers: [],
      messages: [],
      joinRequests: [],
      notice: null,
    });
    this.system("Bluetooth session started. Show the QR so peers can join.");
    return bleQr;
  };

  /** Join a mesh from a scanned/imported invite payload. */
  joinBle = async (payloadText: string, name: string): Promise<void> => {
    this.teardown();
    const payload = decodeQRPayload(payloadText.trim());
    const displayName = name.trim() || "Guest";
    const keyPair = generateSigningKeyPair();
    const token = issueRoleToken({
      sessionId: payload.sid,
      name: displayName,
      subjectPubkey: keyPair.publicKey,
      role: "listener",
      issuerPrivateKey: keyPair.privateKey,
      issuerPubkey: keyPair.publicKey,
    });

    const transport = new BleTransport(createDualRoleAdapter());
    await transport.start();

    const runtime: Runtime = {
      isHost: false,
      role: "listener",
      sessionId: payload.sid,
      sessionKey: payload.sk,
      adminPubKey: payload.apk,
      sessionStart: payload.st,
      name: displayName,
      keyPair,
      token,
      delegations: [],
      transport,
      mesh: null as unknown as MeshNode,
      pendingJoinPeers: new Map(),
      incoming: new Map(),
    };
    runtime.mesh = new MeshNode({
      transport,
      sessionId: payload.sid,
      sessionKey: payload.sk,
      sessionStart: payload.st,
      adminPubKey: payload.apk,
      identity: this.identity({ name: displayName, role: "listener", token, keyPair }),
      onMessage: this.onMessage,
      onPeerJoin: () => this.set({ peers: runtime.mesh.peers.list() }),
      onPeerLeave: () => this.set({ peers: runtime.mesh.peers.list() }),
    });
    runtime.mesh.start();
    this.runtime = runtime;

    this.set({
      screen: "active",
      role: "listener",
      sessionId: payload.sid,
      name: displayName,
      isHost: false,
      pin: null,
      transport: "ble",
      bleQr: null,
      peers: [],
      messages: [],
      joinRequests: [],
      notice: null,
    });
    this.system("Joined the Bluetooth mesh. Waiting for approval…");
    runtime.mesh.send("join_request", { name: displayName, pubkey: keyPair.publicKey });
  };

  send = (text: string): void => {
    const rt = this.runtime;
    if (!rt) return;
    const trimmed = text.trim();
    if (!trimmed || !canSend(rt.role)) return;
    rt.mesh.send("chat", { text: trimmed });
    this.set({
      messages: [
        ...this.state.messages,
        {
          id: randomUUID(),
          ts: Date.now(),
          name: rt.name,
          pubkey: rt.keyPair.publicKey,
          role: rt.role,
          content: trimmed,
        },
      ],
    });
  };

  approve = (peerId: string, role: Role): void => {
    const rt = this.runtime;
    if (!rt) return;
    const request = rt.pendingJoinPeers.get(peerId);
    if (!request) return;
    const token = issueRoleToken({
      sessionId: rt.sessionId,
      name: request.name,
      subjectPubkey: request.pubkey,
      role,
      issuerPrivateKey: rt.isHost ? rt.adminPrivateKey! : rt.keyPair.privateKey,
      issuerPubkey: rt.isHost ? rt.adminPubKey : rt.keyPair.publicKey,
    });
    const body: JoinAcceptBody = { token };
    if (role === "moderator") {
      body.delegation = issueDelegationCert({
        sessionId: rt.sessionId,
        subjectPubkey: request.pubkey,
        issuerPrivateKey: rt.isHost ? rt.adminPrivateKey! : rt.keyPair.privateKey,
        issuerPubkey: rt.adminPubKey,
      });
    }
    rt.mesh.send("join_accept", body);
    rt.pendingJoinPeers.delete(peerId);
    this.set({ joinRequests: this.state.joinRequests.filter((r) => r.peerId !== peerId) });
    this.system(`${request.name} joined as ${role}.`);
  };

  revoke = (pubkey: Uint8Array): void => {
    const rt = this.runtime;
    if (!rt) return;
    rt.mesh.revoke([pubkey]);
    rt.mesh.send("token_revoke", { revoke: [pubkey] } satisfies TokenRevokeBody);
    this.set({ peers: rt.mesh.peers.list() });
  };

  reject = (peerId: string): void => {
    const rt = this.runtime;
    if (!rt) return;
    rt.mesh.send("join_reject", { reason: "declined" });
    rt.pendingJoinPeers.delete(peerId);
    this.set({ joinRequests: this.state.joinRequests.filter((r) => r.peerId !== peerId) });
  };

  private updateTransfer(id: string, patch: Partial<NativeTransfer>): void {
    this.set({
      transfers: this.state.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }

  /** Pick a file and stream it to the session (works over relay and BLE). */
  sendFile = async (): Promise<void> => {
    const rt = this.runtime;
    if (!rt) return;
    if (!canSend(rt.role)) throw new Error("You cannot send files");
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset) return;
    const uri = String(asset.uri);
    const name = String(asset.name ?? "file");
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = fromBase64(base64);
    const transferId = randomUUID();
    const digest = hash(bytes);

    this.set({
      transfers: [
        { id: transferId, name, size: bytes.length, progress: 0, status: "active", direction: "out" },
        ...this.state.transfers,
      ],
    });
    rt.mesh.send("file_offer", {
      transferId,
      name,
      size: bytes.length,
      mime: String(asset.mimeType ?? "application/octet-stream"),
      hash: digest,
    } satisfies FileOfferBody);

    const total = Math.max(1, Math.ceil(bytes.length / FILE_CHUNK_BYTES));
    for (let index = 0; index < total; index++) {
      const slice = bytes.subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
      rt.mesh.send("file_chunk", {
        transferId,
        index,
        data: slice.slice(),
      } satisfies FileChunkBody);
      this.updateTransfer(transferId, { progress: Math.round(((index + 1) / total) * 100) });
      if (index % 32 === 31) await new Promise((r) => setTimeout(r, 0));
    }
    rt.mesh.send("file_complete", { transferId } satisfies FileCompleteBody);
    this.updateTransfer(transferId, { progress: 100, status: "done" });
    zeroize(bytes);
  };

  private async finishIncomingFile(transferId: string): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;
    const file = rt.incoming.get(transferId);
    if (!file) return;
    const total = file.chunks.reduce((n, c) => n + (c?.length ?? 0), 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of file.chunks) {
      if (!chunk) continue;
      merged.set(chunk, offset);
      offset += chunk.length;
      zeroize(chunk);
    }
    if (!timingSafeEqual(hash(merged), file.hash)) {
      this.updateTransfer(transferId, { status: "error" });
      rt.incoming.delete(transferId);
      zeroize(merged);
      return;
    }
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const dir = FileSystem.cacheDirectory ?? "";
      const path = `${dir}ghostwire-${transferId}-${safeName}`;
      await FileSystem.writeAsStringAsync(path, toBase64(merged), {
        encoding: FileSystem.EncodingType.Base64,
      });
      this.updateTransfer(transferId, { status: "done", progress: 100, url: path });
    } catch {
      this.updateTransfer(transferId, { status: "error" });
    }
    rt.incoming.delete(transferId);
  }

  /** Open the OS share sheet for a received file. */
  shareFile = async (id: string): Promise<void> => {
    const transfer = this.state.transfers.find((t) => t.id === id);
    if (!transfer?.url) return;
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(transfer.url);
  };

  panicWipe = (): void => {
    this.teardown();
    this.set({ ...initialState });
  };

  private teardown(): void {
    const rt = this.runtime;
    if (!rt) return;
    this.runtime = null;
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
    void rt.localRelay?.close();
    zeroize(rt.sessionKey, rt.keyPair.privateKey, rt.adminPrivateKey);
  }
}

