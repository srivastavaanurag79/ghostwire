/** Wire-level constants. Bumping these is a protocol break. */
export const PROTOCOL_VERSION = 1;

/** Default remaining hop budget for a newly created message. */
export const DEFAULT_TTL = 5;

/** Absolute hop ceiling. A message that has travelled this far is dropped. */
export const MAX_HOPS = 10;

/** Upper bound on the in-memory dedup cache (LRU). */
export const SEEN_CACHE_LIMIT = 10_000;

/** Reject messages whose timestamp is further than this from local time. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Heartbeat cadence for liveness detection. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** Peer is considered gone after this long without any traffic. */
export const PEER_TIMEOUT_MS = 20_000;

/** Default file chunk size for chunked transfers. */
export const FILE_CHUNK_BYTES = 16 * 1024;

/** Prefix used to domain-separate the AEAD associated data. */
export const AAD_PREFIX = "ghostwire";

/** Default role token lifetime (seconds). */
export const DEFAULT_TOKEN_TTL_SECONDS = 12 * 60 * 60;

/** How often the session key ratchet advances a step. */
export const KEY_ROTATION_INTERVAL_MS = 60_000;

/** Number of recent epoch keys kept so out-of-order messages still decrypt. */
export const KEY_RETAIN_EPOCHS = 32;

/** Upper bound on how many epochs we will derive in one jump. */
export const MAX_EPOCH_FORWARD = 4096;

/**
 * Features a client understands. Exchanged via `peer_announce` so a deployment
 * can tell whether peers support something before relying on it.
 */
export const PROTOCOL_CAPABILITIES = ["multi-admin", "msg-jitter", "relay-rejoin"] as const;

/**
 * Optional randomized delay (ms) applied to outbound chat before it is sent, to
 * blunt timing correlation. 0 disables it (keeps behaviour deterministic).
 */
export const CHAT_JITTER_MS = 0;
