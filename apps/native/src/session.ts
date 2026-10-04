import {
  fromBase64,
  generateSigningKeyPair,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  toBase64,
  zeroize,
  type KeyPair,
} from "@ghostwire/crypto";
import { MeshNode, type MeshIdentity } from "@ghostwire/mesh";
import { canSend, issueDelegationCert, issueRoleToken } from "@ghostwire/roles";
import type {
  ChatBody,
  ChatMessage,
  DelegationCert,
  InnerMessage,
  JoinAcceptBody,
  JoinRequestBody,
  MessageBody,
  MessageType,
  Peer,
  Role,
  RoleToken,
  TokenIssueBody,
  TokenRevokeBody,
} from "@ghostwire/protocol";
import { WebSocketTransport, type Transport } from "@ghostwire/transport";

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
  notice: string | null;
  transport: "relay" | "ble" | null;
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
  notice: null,
  transport: null,
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
    rt.mesh.send("token_revoke", { revoke: [pubkey] });
    this.set({ peers: rt.mesh.peers.list() });
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
    zeroize(rt.sessionKey, rt.keyPair.privateKey, rt.adminPrivateKey);
  }
}
