/** The four session roles, ordered from most to least privileged. */
export type Role = "admin" | "moderator" | "speaker" | "listener";

/** Numeric privilege ranking; higher means more privilege. */
export const ROLE_RANK: Record<Role, number> = {
  listener: 0,
  speaker: 1,
  moderator: 2,
  admin: 3,
};

export function isRole(value: unknown): value is Role {
  return (
    value === "admin" || value === "moderator" || value === "speaker" || value === "listener"
  );
}

/**
 * A signed credential binding a display name and ephemeral public key to a
 * role inside one session. Issued by the admin (any role) or a delegated
 * moderator (speaker/listener only).
 */
export interface RoleToken {
  v: 1;
  /** Session id this token belongs to. */
  sid: string;
  /** Chosen display name. */
  name: string;
  /** The holder's ephemeral Ed25519 public key. */
  pubkey: Uint8Array;
  role: Role;
  /** Unix seconds after which the token is rejected. */
  expiry: number;
  /** Public key of the issuer (admin or moderator). */
  issuer: Uint8Array;
  /** Ed25519 signature over the canonical token bytes. */
  signature: Uint8Array;
}

/** Permissions a moderator may be delegated by the admin. */
export type DelegatedPermission = "approve" | "revoke";

/** Proof, signed by the admin, that a moderator may issue tokens. */
export interface DelegationCert {
  v: 1;
  sid: string;
  /** Moderator public key being delegated to. */
  subjectPubkey: Uint8Array;
  /** Admin public key granting the delegation. */
  issuerPubkey: Uint8Array;
  permissions: DelegatedPermission[];
  expiry: number;
  signature: Uint8Array;
}

/** Sender identity carried *inside* the encrypted payload. */
export interface SenderInfo {
  name: string;
  pubkey: Uint8Array;
  role: Role;
  token: RoleToken;
}

/** Every message type that can travel through the mesh. */
export type MessageType =
  | "chat"
  | "join_request"
  | "join_accept"
  | "join_reject"
  | "token_issue"
  | "token_revoke"
  | "admin_grant"
  | "session_close"
  | "peer_announce"
  | "peer_leave"
  | "file_offer"
  | "file_accept"
  | "file_chunk"
  | "file_complete"
  | "ping";

export const MESSAGE_TYPES: readonly MessageType[] = [
  "chat",
  "join_request",
  "join_accept",
  "join_reject",
  "token_issue",
  "token_revoke",
  "admin_grant",
  "session_close",
  "peer_announce",
  "peer_leave",
  "file_offer",
  "file_accept",
  "file_chunk",
  "file_complete",
  "ping",
] as const;

/**
 * Decrypted, authenticated message. The sender identity lives here (not in the
 * cleartext envelope) so relays and network observers cannot tell who sent what.
 */
export interface InnerMessage {
  v: 1;
  id: string;
  type: MessageType;
  ts: number;
  sender: SenderInfo;
  body: MessageBody;
}

/** Union of all control/data payloads keyed by their message type. */
export type MessageBody =
  | ChatBody
  | JoinRequestBody
  | JoinAcceptBody
  | JoinRejectBody
  | TokenIssueBody
  | TokenRevokeBody
  | AdminGrantBody
  | SessionCloseBody
  | PeerAnnounceBody
  | PeerLeaveBody
  | FileOfferBody
  | FileAcceptBody
  | FileChunkBody
  | FileCompleteBody
  | PingBody;

export interface ChatBody {
  text: string;
  /** Random padding so ciphertext length does not reveal message length. */
  padding?: Uint8Array;
}

export interface JoinRequestBody {
  name: string;
  pubkey: Uint8Array;
  /** Optional X25519 key for private admin replies. */
  encPubkey?: Uint8Array;
}

export interface JoinAcceptBody {
  token: RoleToken;
  /** Present when the approved role is moderator, to delegate issuing rights. */
  delegation?: DelegationCert;
}

export interface JoinRejectBody {
  reason?: string;
}

export interface TokenIssueBody {
  token: RoleToken;
}

export interface TokenRevokeBody {
  /** Ephemeral public keys whose tokens are revoked. */
  revoke: Uint8Array[];
  reason?: string;
}

/** Admin signs in another admin public key (multi-admin sessions). */
export interface AdminGrantBody {
  pubkey: Uint8Array;
  name?: string;
}

export interface SessionCloseBody {
  reason?: string;
}

export interface PeerAnnounceBody {
  /** Known peers, used for lightweight peer exchange. */
  peers: Array<{ name: string; pubkey: Uint8Array; role: Role }>;
  /** Protocol version of the announcer, for version negotiation. */
  pv?: number;
  /** Advertised capabilities. */
  caps?: string[];
}

export interface PeerLeaveBody {
  reason?: string;
}

export interface FileOfferBody {
  transferId: string;
  name: string;
  size: number;
  mime: string;
  /** SHA-256 of the plaintext file. */
  hash: Uint8Array;
}

export interface FileAcceptBody {
  transferId: string;
}

export interface FileChunkBody {
  transferId: string;
  index: number;
  data: Uint8Array;
}

export interface FileCompleteBody {
  transferId: string;
}

export interface PingBody {
  nonce: string;
}

/**
 * Opaque wire envelope. Contains no names, keys or roles in the clear: only a
 * random id, timing, hop counters and the AEAD ciphertext. Relays can forward
 * it without learning anything about the sender.
 */
export interface Envelope {
  v: 1;
  /** Random UUID; also the dedup key. */
  id: string;
  /** Sender clock, unix milliseconds. */
  ts: number;
  /** Key-ratchet epoch used to encrypt this message. */
  epoch: number;
  /** Remaining hop budget; mutated by relays. */
  ttl: number;
  /** Hops travelled so far; mutated by relays. */
  hops: number;
  /** AES-GCM nonce (12 bytes). */
  nonce: Uint8Array;
  /** AES-GCM ciphertext of the msgpack-encoded InnerMessage (tag appended). */
  ciphertext: Uint8Array;
  /** Ed25519 signature by the sender over the associated data + nonce + ciphertext. */
  signature: Uint8Array;
}

/** A peer as tracked by the mesh and surfaced to the UI. */
export interface Peer {
  id: string;
  name: string;
  pubkey: Uint8Array;
  role: Role;
  connectedAt: number;
  lastSeen: number;
}

/** Message as rendered in the chat UI. */
export interface ChatMessage {
  id: string;
  ts: number;
  name: string;
  pubkey: Uint8Array;
  role: Role;
  content: string;
  isSystem?: boolean;
}
