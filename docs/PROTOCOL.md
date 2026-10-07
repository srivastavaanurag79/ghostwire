# Protocol

GhostWire's wire protocol is transport-agnostic. It is defined in `@ghostwire/protocol` and consumed
unchanged by web, native, and the relay (which never decrypts).

- **Encoding:** [MessagePack](https://msgpack.org/) for binary structure, JSON only for QR control.
- **Version:** `PROTOCOL_VERSION = 1`.
- **Constants:** default TTL `5`, max hops `10`, dedup cache `10_000`, clock skew `±5 min`,
  key rotation `60 s`, retained epochs `32`.

## Envelope (outer, cleartext)

The outer envelope is all a relay sees. It contains **no names, keys, or roles**.

```ts
interface Envelope {
  v: 1;
  id: string;         // random UUID (dedup key)
  ts: number;         // sender clock, unix ms
  epoch: number;      // key-ratchet epoch used
  ttl: number;        // remaining hops (mutated by relays)
  hops: number;       // hops so far (mutated by relays)
  nonce: Uint8Array;  // 12-byte AES-GCM nonce
  ciphertext: Uint8Array; // AES-GCM(InnerMessage), tag appended
  signature: Uint8Array;  // Ed25519 over AAD || nonce || ciphertext
}
```

Associated data (AAD), bound into the AEAD tag and the signature:

```
"ghostwire|1|<id>|<ts>|<epoch>"
```

`ttl` and `hops` are intentionally **not** in the AAD, because relays must be able to rewrite them.
Everything else is immutable and tamper-evident.

## Inner message (encrypted)

```ts
interface InnerMessage {
  v: 1;
  id: string;
  type: MessageType;
  ts: number;
  sender: {
    name: string;
    pubkey: Uint8Array;   // ephemeral Ed25519 public key
    role: Role;
    token: RoleToken;     // signed credential
  };
  body: MessageBody;      // type-specific
}
```

Putting the sender identity **inside** the ciphertext means a network observer or relay cannot tell
who sent a message — a deliberate improvement over designs that carry names in the clear.

## Encryption & key schedule

```
sessionKey                 (256-bit, delivered only via QR)
  └─ epoch key  k[n] = HKDF(k[n-1], "ghostwire|ratchet|n")       one-way ratchet
       └─ message key = HKDF(k[n], nonce, "ghostwire|msg|<id>")  per-message
            └─ AES-256-GCM(messageKey, nonce, aad) → ciphertext
signature = Ed25519(ephemeralPrivateKey, aad || nonce || ciphertext)
```

- The ratchet advances on a schedule anchored at `sessionStart`; peers stay in lockstep without extra
  messages. A receiver derives forward to the epoch named in the envelope.
- Retained epochs are bounded; older epoch keys are zeroized. A one-way HKDF chain means past epochs
  **cannot** be recomputed from a later key — forward secrecy.
- Opening: look up `epoch` key → AEAD-decrypt → msgpack-decode → verify signature against
  `sender.pubkey` → verify the role token → check the role/action matrix.

## Role tokens

```ts
interface RoleToken {
  v: 1;
  sid: string;
  name: string;
  pubkey: Uint8Array;   // holder's ephemeral key
  role: "admin" | "moderator" | "speaker" | "listener";
  expiry: number;       // unix seconds
  issuer: Uint8Array;   // admin or moderator pubkey
  signature: Uint8Array;
}
```

Canonical signed bytes (deterministic msgpack array):

```
[v, sid, name, pubkey, role, expiry, issuer]
```

**Delegation certificate** (admin → moderator):

```ts
interface DelegationCert {
  v: 1;
  sid: string;
  subjectPubkey: Uint8Array; // moderator
  issuerPubkey: Uint8Array;  // admin
  permissions: ("approve" | "revoke")[];
  expiry: number;
  signature: Uint8Array;
}
```

Signed bytes: `[v, sid, subjectPubkey, issuerPubkey, permissions, expiry]`.

## Verification pipeline

On every inbound message, in order:

1. Decode the envelope; drop malformed.
2. Dedup by `id`; drop duplicates.
3. `|now − ts| ≤ 5 min`; drop stale.
4. Compare `sender.pubkey` with `sender.token.pubkey`; drop mismatch.
5. Drop if the sender's key is revoked.
6. **If not `join_request`:** verify the role token (admin signature, or a moderator delegation that
   chains to the admin and grants the action), then check the role/action matrix.
7. Decrypt and verify the Ed25519 signature; drop on failure.
8. Deliver to the app.
9. Rebroadcast only authenticated traffic, with `ttl − 1`, to all peers except the sender.

A `join_request` is the one message accepted before a real token exists: it is group-authenticated
(only session-key holders can produce it) and self-signed, and the admin replies with a signed token.

## Role / action matrix

| Action | Admin | Moderator | Speaker | Listener |
|---|---|---|---|---|
| `chat`, files | ✅ | ✅ | ✅ | ❌ |
| `token_issue`, `token_revoke` | ✅ | ✅ | ❌ | ❌ |
| `session_close` | ✅ | ❌ | ❌ | ❌ |
| read | ✅ | ✅ | ✅ | ✅ |

Moderators can only grant `speaker`/`listener`, and only when their delegation includes `approve`.

## Message types

| Type | Body | Purpose |
|---|---|---|
| `chat` | `{ text, padding? }` | Text message (padded to blunt length correlation) |
| `join_request` | `{ name, pubkey, encPubkey? }` | Ask to join |
| `join_accept` | `{ token, delegation? }` | Grant a role |
| `join_reject` | `{ reason? }` | Decline a request |
| `token_issue` | `{ token }` | Change a participant's role |
| `token_revoke` | `{ revoke: Uint8Array[], reason? }` | Revoke keys |
| `admin_grant` | `{ pubkey, name? }` | Admin signs in another admin (multi-admin) |
| `session_close` | `{ reason? }` | Admin ends the session |
| `peer_announce` | `{ peers[], pv?, caps? }` | Presence + protocol version/capabilities |
| `peer_leave` | `{ reason? }` | Graceful departure |
| `file_offer` | `{ transferId, name, size, mime, hash }` | Announce a file |
| `file_accept` | `{ transferId }` | Accept a transfer |
| `file_chunk` | `{ transferId, index, data }` | ~16 KB chunk |
| `file_complete` | `{ transferId }` | Transfer finished |
| `ping` | `{ nonce }` | Liveness heartbeat (5 s) |

## QR bootstrap payload

Encoded as msgpack, base64url, prefixed `GW1:`, and kept well under 1 KB.

```ts
interface QRPayload {
  v: 1;
  sid: string;          // session id
  role: Role;           // role this QR invites
  sk: Uint8Array;       // session key
  apk: Uint8Array;      // admin public key
  st: number;           // sessionStart (ratchet anchor)
  token?: RoleToken;    // optional pre-issued credential
  sig?: { type: "offer" | "answer"; sdp: string; id?: string };
  aek?: Uint8Array;     // optional X25519 key for private replies
}
```

**Dance:** host `createOffer()` → QR with `sig.type="offer"` → joiner `acceptOffer()` → QR with
`sig.type="answer"` → host `acceptAnswer(id, answer)` → data channel opens.

## Relay framing

For `apps/relay` (WebSocket), the client sends:

```
broadcast : 0x00 || payload
directed  : 0x01 || targetLen(1) || targetId || payload
```

and the server sends `senderLen(1) || senderId || payload`, plus JSON control frames
(`welcome`/`join`/`leave`). The relay never inspects or decrypts payloads.

## Versioning

Any incompatible wire change bumps `PROTOCOL_VERSION`. Nodes reject envelopes whose `v` they do not
support. Backward-compatible additions (new optional fields, new message types) keep the same
version.

## Multi-admin, capabilities, and timing

- **Multi-admin.** An admin may sign in additional admin public keys with `admin_grant`. Every node
  treats any key in its admin set as a valid token issuer, so a co-admin can issue roles and grants.
  A node only accepts `admin_grant` from a sender whose key is already an admin. Grants are ordinary
  mesh messages (not replayed to late joiners; re-grant if needed).
- **Version / capability negotiation.** `peer_announce` carries `pv` (protocol version) and `caps`
  (e.g. `multi-admin`, `msg-jitter`, `relay-rejoin`). Nodes store a peer's advertised capabilities and
  the UI warns on a version mismatch. Capabilities let a deployment gate optional behaviour instead of
  breaking older peers.
- **Optional timing padding.** A node may configure `chatJitterMs` to add a small random delay before
  broadcasting chat, reducing timing correlation. It defaults to 0 (deterministic; tests rely on it).
