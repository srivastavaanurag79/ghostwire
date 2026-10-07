import {
  CLOCK_SKEW_MS,
  DEFAULT_TTL,
  MAX_HOPS,
  PROTOCOL_VERSION,
  SessionKeyring,
  decodeEnvelope,
  encodeEnvelope,
  forwardEnvelope,
  isForwardable,
  openEnvelope,
  sealEnvelope,
  type DelegationCert,
  type Envelope,
  type AdminGrantBody,
  type PeerAnnounceBody,
  type InnerMessage,
  type MessageBody,
  type MessageType,
  type Peer,
  type Role,
  type RoleToken,
} from "@ghostwire/protocol";
import { canSend, verifyRoleToken, type TrustContext } from "@ghostwire/roles";
import { timingSafeEqual } from "@ghostwire/crypto";
import type { Transport } from "@ghostwire/transport";
import { SeenCache } from "./dedup";
import { PeerRegistry } from "./peers";

/** Local cryptographic identity used to seal outbound messages. */
export interface MeshIdentity {
  name: string;
  role: Role;
  token: RoleToken;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface MeshNodeOptions {
  transport: Transport;
  sessionId: string;
  sessionKey: Uint8Array;
  /** Unix ms when the session was created; anchors the key-ratchet schedule. */
  sessionStart: number;
  adminPubKey: Uint8Array;
  /** Extra admin keys (multi-admin sessions). */
  additionalAdmins?: Uint8Array[];
  identity: MeshIdentity;
  delegations?: DelegationCert[];
  /** Called for every authenticated, role-valid inner message. */
  onMessage: (inner: InnerMessage, fromPeerId: string) => void;
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string, peer?: Peer) => void;
  /** Called when a message is dropped; for local diagnostics only. */
  onDrop?: (reason: string, envelope?: Envelope) => void;
  dedupLimit?: number;
  ttl?: number;
  maxHops?: number;
  /** Randomized outbound delay (ms) for chat, to blunt timing correlation. */
  chatJitterMs?: number;
}

/**
 * Transport-agnostic gossip node.
 *
 * Inbound flow: decode -> dedup -> decrypt -> verify signature -> verify role
 * token -> role/action check -> deliver -> rebroadcast.
 *
 * Rebroadcasting only authenticated traffic means a relay can never amplify
 * forgeries, and dedup by message id keeps the flood bounded.
 */
export class MeshNode {
  private readonly seen: SeenCache;
  private readonly registry = new PeerRegistry();
  private readonly delegations = new Map<string, DelegationCert>();
  private readonly revoked = new Set<string>();
  private readonly adminKeys: Uint8Array[];
  private readonly peerCaps = new Map<string, { pv?: number; caps: string[] }>();
  private readonly keyring: SessionKeyring;
  private unsubscribers: Array<() => void> = [];
  private running = false;

  constructor(private readonly options: MeshNodeOptions) {
    this.seen = new SeenCache(options.dedupLimit);
    this.keyring = new SessionKeyring(options.sessionKey, options.sessionStart);
    this.adminKeys = [options.adminPubKey, ...(options.additionalAdmins ?? [])];
    for (const cert of options.delegations ?? []) this.addDelegation(cert);
  }

  get peers(): PeerRegistry {
    return this.registry;
  }

  get identity(): MeshIdentity {
    return this.options.identity;
  }

  /** Update the local identity in place (e.g. after a join_accept token). */
  updateIdentity(patch: Partial<MeshIdentity>): void {
    Object.assign(this.options.identity, patch);
  }

  /** Add public keys to the local revocation list; their traffic is dropped. */
  revoke(pubkeys: Uint8Array[]): void {
    for (const key of pubkeys) this.revoked.add(encodeKey(key));
  }

  isRevoked(pubkey: Uint8Array): boolean {
    return this.revoked.has(encodeKey(pubkey));
  }

  /** Register an additional admin key (multi-admin sessions). */
  addAdmin(pubkey: Uint8Array): void {
    if (this.adminKeys.some((key) => timingSafeEqual(key, pubkey))) return;
    this.adminKeys.push(pubkey);
  }

  isAdmin(pubkey: Uint8Array): boolean {
    return this.adminKeys.some((key) => timingSafeEqual(key, pubkey));
  }

  /** Capabilities/protocol version advertised by a peer (from peer_announce). */
  peerInfo(pubkey: Uint8Array): { pv?: number; caps: string[] } | undefined {
    return this.peerCaps.get(encodeKey(pubkey));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const { transport } = this.options;
    this.unsubscribers = [
      transport.onMessage((peerId, data) => this.ingest(peerId, data)),
      transport.onPeerJoin((peerId) => {
        this.options.onPeerJoin?.(peerId);
      }),
      transport.onPeerLeave((peerId) => {
        const peer = this.registry.get(peerId);
        this.registry.remove(peerId);
        this.options.onPeerLeave?.(peerId, peer);
      }),
    ];
  }

  stop(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.running = false;
  }

  /** Clear all in-memory per-session state (used by wipe / close). */
  wipe(): void {
    this.stop();
    this.seen.clear();
    this.registry.clear();
    this.delegations.clear();
    this.revoked.clear();
    this.keyring.wipe();
  }

  /** Seal `body` into an envelope and flood it to every peer. */
  send(type: MessageType, body: MessageBody): Envelope {
    const { identity, ttl } = this.options;
    if (!isActionAllowed(identity.role, type)) {
      throw new Error(`role ${identity.role} may not send ${type}`);
    }
    const envelope = sealEnvelope({
      keyring: this.keyring,
      type,
      body,
      ttl: ttl ?? DEFAULT_TTL,
      sender: {
        name: identity.name,
        pubkey: identity.publicKey,
        role: identity.role,
        token: identity.token,
      },
      signerPrivateKey: identity.privateKey,
    });
    this.seen.add(envelope.id);
    // The granting admin trusts the new admin immediately.
    if (type === "admin_grant") {
      const granted = (body as AdminGrantBody)?.pubkey;
      if (granted?.length) this.addAdmin(granted);
    }
    const bytes = encodeEnvelope(envelope);
    const jitter = this.options.chatJitterMs ?? 0;
    if (type === "chat" && jitter > 0) {
      // Randomize the send time so message timing is harder to correlate.
      const delay = Math.floor(Math.random() * jitter);
      setTimeout(() => this.options.transport.broadcast(bytes), delay);
    } else {
      this.options.transport.broadcast(bytes);
    }
    return envelope;
  }

  /** Register a moderator delegation cert learned from the admin. */
  addDelegation(cert: DelegationCert): void {
    this.delegations.set(encodeKey(cert.subjectPubkey), cert);
  }

  private trustContext(): TrustContext {
    return {
      sessionId: this.options.sessionId,
      adminPubKey: this.options.adminPubKey,
      adminPubKeys: this.adminKeys.slice(1),
      delegations: [...this.delegations.values()],
    };
  }

  private ingest(fromPeerId: string, data: Uint8Array): void {
    let envelope: Envelope;
    try {
      envelope = decodeEnvelope(data);
    } catch {
      return this.drop("malformed envelope");
    }

    if (!this.seen.add(envelope.id)) return;

    let inner: InnerMessage;
    try {
      const opened = openEnvelope(envelope, this.keyring);
      if (!opened.signatureValid) return this.drop("bad inner signature", envelope);
      inner = opened.inner;
    } catch {
      return this.drop("cannot decrypt envelope", envelope);
    }

    // Timestamp window guards against replay of very old floods.
    if (Math.abs(Date.now() - inner.ts) > CLOCK_SKEW_MS) {
      return this.drop("timestamp outside window", envelope);
    }

    // Identity must match the token it presents.
    if (!timingSafeEqual(inner.sender.pubkey, inner.sender.token.pubkey)) {
      return this.drop("token/pubkey mismatch", envelope);
    }

    if (this.isRevoked(inner.sender.pubkey)) {
      return this.drop("sender revoked", envelope);
    }

    // A join_request is the one message sent before a real token exists. It is
    // already group-authenticated (the sender knows the session key) and
    // self-signed, so we accept it without role verification. The admin replies
    // with a properly signed token. Every other message must carry a valid token.
    if (inner.type !== "join_request") {
      const tokenResult = verifyRoleToken(inner.sender.token, this.trustContext());
      if (!tokenResult.ok) return this.drop(`token rejected: ${tokenResult.reason}`, envelope);

      if (!isActionAllowed(inner.sender.role, inner.type)) {
        return this.drop(`role ${inner.sender.role} cannot send ${inner.type}`, envelope);
      }
    }

    const isSelf = timingSafeEqual(inner.sender.pubkey, this.options.identity.publicKey);

    if (inner.type === "admin_grant") {
      if (!this.isAdmin(inner.sender.pubkey)) {
        return this.drop("admin_grant from a non-admin", envelope);
      }
      const body = inner.body as AdminGrantBody;
      if (body?.pubkey?.length) {
        this.addAdmin(body.pubkey);
        this.registry.upsert(fromPeerId, {
          name: inner.sender.name,
          pubkey: inner.sender.pubkey,
          role: inner.sender.role,
        });
      }
    }

    if (inner.type === "peer_announce") {
      const body = inner.body as PeerAnnounceBody;
      this.peerCaps.set(encodeKey(inner.sender.pubkey), {
        pv: body.pv,
        caps: body.caps ?? [],
      });
    }

    if (inner.type === "ping" || inner.type === "peer_announce") {
      this.registry.upsert(fromPeerId, {
        name: inner.sender.name,
        pubkey: inner.sender.pubkey,
        role: inner.sender.role,
      });
    }

    this.options.onMessage(inner, fromPeerId);

    // Relay authenticated traffic only, never back to the sender.
    if (!isSelf && isForwardable(envelope, this.options.maxHops ?? MAX_HOPS)) {
      const forwarded = encodeEnvelope(forwardEnvelope(envelope));
      this.options.transport.broadcast(forwarded, fromPeerId);
    }
  }

  private drop(reason: string, envelope?: Envelope): void {
    this.options.onDrop?.(reason, envelope);
  }
}

/** Role/action matrix from the spec. */
export function isActionAllowed(role: Role, type: MessageType): boolean {
  switch (type) {
    case "chat":
    case "file_offer":
    case "file_accept":
    case "file_chunk":
    case "file_complete":
      return canSend(role);
    case "token_issue":
    case "token_revoke":
      return role === "admin" || role === "moderator";
    case "admin_grant":
      return role === "admin";
    case "session_close":
      return role === "admin";
    case "join_request":
    case "join_accept":
    case "join_reject":
    case "peer_announce":
    case "peer_leave":
    case "ping":
      return true;
    default:
      return false;
  }
}

function encodeKey(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export const MESH_PROTOCOL_VERSION = PROTOCOL_VERSION;
