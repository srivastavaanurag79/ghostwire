# Security Review (Internal Audit)

> **Scope note:** This is an **internal** review performed by the project maintainers. It is **not an
> independent third-party audit**, and it does not carry the assurance of one. An external audit is
> still recommended before relying on GhostWire in a high-risk deployment. What follows is honest,
> reproducible, and includes what we did *not* fix and why.

- **Date:** 2026
- **Version reviewed:** `@ghostwire/*` 0.1.0, web PWA, relay, native app
- **Method:** manual code review of the pure-TS core and the platform shells, review of the
  cryptographic constructions against their intended properties, and adversarial reading of tests.

## What was reviewed

| Area | Where |
|---|---|
| Crypto primitives & wrappers | `packages/crypto/src/*` |
| Envelope sealing/opening, key ratchet | `packages/protocol/src/codec.ts`, `keyring.ts` |
| Role tokens, delegation, verification | `packages/roles/src/index.ts` |
| Authenticated gossip & verification pipeline | `packages/mesh/src/node.ts` |
| Transports (WebRTC, WebSocket, framing) | `packages/transport/src/*` |
| QR payload & SDP codec | `packages/qr/src/index.ts`, `sdp.ts` |
| Relay room protocol | `apps/relay/relay.mjs` |
| Web session engine & UI | `apps/web/lib/session.ts`, `app/*` |
| Native engine, BLE, on-phone relay | `apps/native/src/*` |

## Findings

### S-1 — Relay PIN brute-force could expose the session bootstrap — **Fixed**

**Severity:** Medium (PIN-only relay mode).
**Description:** In the relay “PIN” flow a host stores the session bootstrap (`sid`, session key,
admin key) for a 6-digit PIN, and a guest receives it after sending `{t:"guest", pin}`. A 6-digit PIN
is only ~20 bits of entropy. A network attacker who can reach the relay could brute-force PINs and,
in PIN-only mode, obtain the **session key** — defeating confidentiality.
**Fix:** The relay now applies a per-IP control rate limit (20 room-control frames per 60s) and
returns a rate-limit error beyond it. See `apps/relay/relay.mjs`; covered by
`relay.test.mjs > relay rate-limits room control attempts`.
**Residual:** Rate limiting slows but does not eliminate brute force against a publicly exposed relay.
For untrusted relays, share the **invite QR/link** (which carries the session key out-of-band) instead
of relying on PIN bootstrap. This is documented in `docs/DEPLOYMENT.md`.

### I-1 — Display-name spoofing by session-key holders — **Accepted**

A `join_request` is intentionally accepted before a role token exists (it is already
group-authenticated by the AEAD). The display name in it is not unique or bound to a pre-existing
identity, so a member who holds the session key can choose any name. Impact is limited to
*pseudonym* collisions within a session; messages remain bound to the sender’s ephemeral key, and the
admin sees which key belongs to which name. Mitigation: the admin approves names, and peers can be
revoked. Documented in `docs/THREAT_MODEL.md` (pseudonymity, not anonymity).

### I-2 — Replay window after restart — **Accepted**

Dedup is an in-memory LRU; after a device restarts, a captured envelope replayed within the ±5-minute
timestamp window could be processed once more. Impact is a possible duplicate display, not forgery
(the Ed25519 signature and AEAD still bind the content). Sessions are ephemeral and short-lived, and
the window is small.

### I-3 — Revocation is a local deny-list — **Accepted**

`token_revoke` adds keys to an in-memory revoked set on nodes that receive it. A device that joins
*after* a revocation does not learn about it, and a reboot clears it. Role tokens also expire
(default 12h). Impact: a revoked peer’s cryptographic token remains valid until expiry for nodes that
never saw the revocation. Mitigation: keep sessions short; re-broadcast revocations when needed. This
is a known limitation of serverless ephemeral sessions and is recorded in the threat model.

### I-4 — Hosted relay sees the session key in PIN-only mode — **Accepted / documented**

To let a PIN alone bootstrap a session, the relay (a meeting point) stores and serves the bootstrap
including the session key. The relay is therefore **trusted** in that mode. The default advice is to
run the relay yourself, or use the relay only for byte forwarding and share the session key via the
QR/link. Documented in `docs/DEPLOYMENT.md` and `PRIVACY.md`.

### I-5 — Bearer role tokens — **Accepted**

Role tokens are bearer credentials: whoever holds the private key can act. A device compromised while
a session is live exposes the live key and tokens (out of scope for any client-side E2EE app). The
ratchet protects *past* message keys, not a currently-live token. Stated in `SECURITY.md`.

### I-6 — BLE peripheral path unverified on hardware — **Open (expected)**

The BLE transport, dual-role adapter, and on-phone relay are code-complete but have not been exercised
on physical radios in this review environment. They require a development build and two devices.
Tracked as the top item on the roadmap.

### I-7 — Multi-admin grants are not replayed to late joiners — **Accepted**

An `admin_grant` is a normal mesh message, so a device that joins later does not automatically learn
about previously granted admin keys. A granting admin can re-grant. Documented here and in the
protocol notes.

## Controls verified (positive findings)

- **AEAD integrity:** ciphertext tampering and AAD substitution are covered by tests and fail closed.
- **Authenticity ordering:** `MeshNode.ingest` decrypts → verifies the Ed25519 signature → verifies
  the role token → checks the role/action matrix before delivering *or* rebroadcasting. Unauthenticated
  traffic is never relayed.
- **Identity binding:** message `sender.pubkey` must equal `token.pubkey`; the signature must verify
  against that key.
- **Forward secrecy:** one-way HKDF ratchet with epoch pruning; a later key cannot recompute earlier
  epochs (property test in `protocol.test.ts`).
- **No persistence:** no session data in `localStorage`, `IndexedDB`, cookies, or the Cache API;
  `zeroize` on wipe; `docs` and code agree.
- **No third parties:** empty ICE server list (no STUN/TURN); no telemetry/analytics; service worker
  does not cache `version.json` or `sw.js`.
- **Input handling:** message content and file names are rendered as text (no `innerHTML`), and
  msgpack/Zod validation rejects malformed structures.
- **Dependency posture:** only audited primitives (`@noble/*`, `@scure/*`) plus `fflate`, `zod`,
  `msgpack`; no custom cryptography.

## Docs claims review

The public docs were checked line-by-line against the implementation:

- `SECURITY.md` — claims match: per-message keys, ratchet, no STUN, no telemetry, panic wipe.
- `PRIVACY.md` — accurate: no servers for the default path; relay metadata caveat is present.
- `docs/THREAT_MODEL.md` — the “out of scope” list matches real behaviour (compromised device,
  malicious participant, admin trust, global passive adversary, metadata).
- `README.md` — the “one QR is enough for BLE” statement is correct (no offer/answer). The web
  direct-QR two-scan requirement is stated.

No incorrect claims were found; the S-1 fix and the I-4 note were added to keep the docs honest.

## Recommendation

1. Treat this as a **self-review**, not an audit.
2. Commission an independent audit of `packages/crypto`, `packages/protocol`, and
   `packages/roles` (small, self-contained, ideal for review).
3. Validate BLE/on-phone relay on real devices (I-6).
4. Consider replay-protecting across restarts (I-2) if session lifetimes grow.
