# Threat Model

This document describes what GhostWire defends against, what it explicitly does not, and the
assumptions behind those claims. It is written to be read by both users and reviewers.

## Assets we protect

1. **Message and file content** — must be readable only by session participants.
2. **Session keys and ephemeral private keys** — must never persist and should be short-lived.
3. **Sender identity within the session** — visible to participants, hidden from network observers
   and relays.
4. **Role integrity** — only the admin (and delegated moderators) can grant or revoke speaking
   rights.
5. **The absence of lasting traces** — after a session ends, no recoverable session data remains.

## Trust boundaries

- **Device** is trusted while the session is live. A compromised device is out of scope.
- **Admin** is trusted with role administration.
- **Session participants** are mutually semi-trusted: they can read the session, but cannot forge
  each other's messages.
- **Transports and relays** are **untrusted** for confidentiality: they only ever see opaque bytes.
- **The network** is untrusted for confidentiality and only partially trusted for metadata.

## Adversaries considered

### 1. Passive network eavesdropper

An attacker on the same Wi-Fi/hotspot or radio range captures traffic.

**Mitigation:** all payloads are AES-256-GCM encrypted with keys never sent on the wire after
bootstrap. The QR bootstrap transfers the session key out-of-band (visually, device to device), not
over the network. Identity (name, public key, role token) travels *inside* the ciphertext, so a
captured packet reveals neither content nor sender.

### 2. Active relay / malicious peer forwarding traffic

An attacker forwards or injects packets.

**Mitigation:** every message is authenticated. Relays forward only after a node has decrypted and
verified the envelope's Ed25519 signature and role token; forged or modified envelopes are dropped
and never rebroadcast. The AEAD associated data binds the immutable header (id, timestamp, key
epoch), so a relay cannot alter routing fields undetected beyond the permitted `ttl`/`hops`.

### 3. Impersonation

An attacker tries to send as another participant.

**Mitigation:** each message carries the sender's ephemeral public key and an admin/moderator-signed
role token bound to that key. The Ed25519 signature must verify against the embedded key, and the
key must match the token. `join_request` is the only pre-token message and is still signed by the
sender's own key and requires possession of the session key.

### 4. Privilege escalation

A listener or speaker tries to speak admin-only actions.

**Mitigation:** the role/action matrix is enforced on receipt (`isActionAllowed`) and tokens are
verified against the admin or a delegation chain. A moderator cannot grant moderator/admin roles.
The sender's client also refuses to emit actions its role forbids.

### 5. Replay

An attacker replays a captured message.

**Mitigation:** unique message ids with an in-memory dedup cache, random per-message nonces, and a
timestamp window that rejects stale messages.

### 6. Device seizure / forensic recovery after the session

Someone obtains the device later and tries to recover messages or keys.

**Mitigation:** nothing is persisted. Messages, keys, tokens, peer names, and the keyring live only
in memory and are wiped on session close, reload, or panic wipe. The key ratchet zeroizes rotated
epoch keys, providing forward secrecy for past epochs.

### 7. External signaling/tracking

A provider correlates users via a server.

**Mitigation:** there is no backend and no external signaling. The default WebRTC transport uses an
empty ICE server list, so no STUN/TURN provider is contacted. There is no telemetry, analytics, or
crash reporting.

## Out of scope

- **Compromised device during a live session.** If an attacker can read memory or the DOM while the
  session is ongoing, they can read live plaintext and keys. This is true of every client-side E2EE
  app. Forward secrecy limits damage to *past* epochs only after they are rotated and zeroized.
- **A malicious participant.** Anyone in the session can read, copy, or screenshot everything. Do
  not invite people you do not trust.
- **The admin.** The admin is trusted and is aware of who they approved.
- **A global passive adversary** performing large-scale traffic correlation.
- **Side channels** (power, timing, electromagnetic) and attacks against the platform or browser.
- **Supply-chain attacks** against your toolchain or dependencies.
- **Legal deniability.** No legal protection is claimed.
- **Availability / DoS.** A flood of traffic can degrade a session; the mesh drops unauthenticated
  traffic but does not guarantee availability.

## Metadata analysis

Content is protected; metadata is minimized but not eliminated.

| Metadata | Visibility | Notes |
|---|---|---|
| Message content | Participants only | Encrypted; identity also encrypted |
| Sender identity | Participants only | Carried inside ciphertext |
| Message size | Network observers | Mitigated by random padding; not eliminated |
| Timing | Network observers | Best-effort batching/padding; not eliminated |
| Peer IP addresses | Direct peers, relay operator | Inherent to P2P/relay networking |
| Presence | Network observers | Devices must be online to exchange |

We deliberately do **not** claim resistance to a determined global passive adversary, and we do not
claim perfect anonymity. We optimize for short-lived, localized, high-privacy coordination where the
alternative is an unencrypted group chat with a persistent server.

## Residual risks

- A participant may disclose screenshots or exported files.
- The admin device is a single point of trust for role decisions.
- Clock skew between devices can cause benign timestamp rejections; the window is generous (5
  minutes).
- The relay mode exposes connection metadata to the relay operator by construction.
