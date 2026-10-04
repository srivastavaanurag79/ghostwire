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
  type InnerMessage,
  type MessageBody,
  type MessageType,
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
  identity: MeshIdentity;
  delegations?: DelegationCert[];
  /** Called for every authenticated, role-valid inner message. */
  onMessage: (inner: InnerMessage, fromPeerId: string) => void;
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  /** Called when a message is dropped; for local diagnostics only. */
  onDrop?: (reason: string, envelope?: Envelope) => void;
  dedupLimit?: number;
  ttl?: number;
  maxHops?: number;
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
  private readonly keyring: SessionKeyring;
  private unsubscribers: Array<() => void> = [];
  private running = false;

  constructor(private readonly options: MeshNodeOptions) {
    this.seen = new SeenCache(options.dedupLimit);
    this.keyring = new SessionKeyring(options.sessionKey, options.sessionStart);
    for (const cert of options.delegations ?? []) this.addDelegation(cert);
  }

  get peers(): PeerRegistry {
    return this.registry;
  }

  get identity(): MeshIdentity {
    return this.options.identity;
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
        this.registry.remove(peerId);
        this.options.onPeerLeave?.(peerId);
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
    this.options.transport.broadcast(encodeEnvelope(envelope));
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

    const tokenResult = verifyRoleToken(inner.sender.token, this.trustContext());
    if (!tokenResult.ok) return this.drop(`token rejected: ${tokenResult.reason}`, envelope);

    if (!isActionAllowed(inner.sender.role, inner.type)) {
      return this.drop(`role ${inner.sender.role} cannot send ${inner.type}`, envelope);
    }

    const isSelf = timingSafeEqual(inner.sender.pubkey, this.options.identity.publicKey);
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
