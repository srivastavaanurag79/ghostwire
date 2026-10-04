# Security Policy

## Reporting a vulnerability

Please **do not open a public issue for security vulnerabilities**. Instead, report privately:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" under the Security tab), or
- Contact a maintainer through the contact details listed in the repository.

Please include: a description, affected version/commit, reproduction steps, and any proof of
concept. We aim to acknowledge reports within a few days and will coordinate disclosure.

We support responsible disclosure and will credit reporters who wish to be named.

## Supported versions

GhostWire is pre-1.0 and evolves quickly. Security fixes are applied to the latest `master` only.

## What GhostWire does protect

| Property | Mechanism |
|---|---|
| Message & file confidentiality | AES-256-GCM, per-message keys derived from a rotated session key |
| Sender authenticity | Ed25519 signatures by each member's ephemeral key |
| Role integrity | Admin/moderator-signed role tokens; delegation certificates |
| Replay resistance | Random nonce, unique message id, timestamp window, dedup cache |
| Forward secrecy of message keys | One-way HKDF key ratchet; old epoch keys are zeroized |
| Eviction of abusers | Signed revocation list; revoked keys are dropped by every node |
| At-rest exposure | Nothing is persisted; panic wipe zeroizes keys and reloads |

Full details, including the exact construction, are in [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) and
[`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md).

## What GhostWire does not protect against

These are **known and accepted** limitations, not bugs:

- **A compromised device during an active session.** If malware or an attacker can read process
  memory or the DOM while a session is live, they can see live plaintext and keys. No client-side
  app can prevent this. Forward secrecy protects *past* epochs once they are rotated and erased, but
  not data currently in RAM.
- **A malicious session participant.** Anyone you invite can read everything sent in the session
  and can copy or screenshot it.
- **The admin.** The admin is trusted by design and sees who joined and their chosen names.
- **Network metadata.** Connection timing, packet sizes, and radio presence can leak information to
  observers on your network. We pad messages and avoid external STUN servers, but this is
  best-effort.
- **A global passive adversary.** This is explicitly out of scope.
- **Legal deniability.** The Software makes no legal claims.
- **Supply-chain compromise** of your toolchain, browser, or the `@noble/*` dependencies.

## Cryptographic choices

- **Ed25519** — message signatures and role-token signatures (`@noble/curves`).
- **X25519 + HKDF-SHA256** — optional key agreement and key derivation (`@noble/curves`,
  `@noble/hashes`).
- **AES-256-GCM** — authenticated encryption of message plaintext (`@noble/ciphers`).
- **Key ratchet** — `k[n] = HKDF(k[n-1], "ghostwire|ratchet|n")`, one-way, epochs pruned.
- **Per-message key** — `HKDF(epochKey, nonce, "ghostwire|msg|<id>")`.
- **Randomness** — CSPRNG via `@noble/hashes` (backed by the platform CSPRNG).

All primitives are pure JavaScript so web and native run identical code. No custom cryptography is
implemented.

## No telemetry

GhostWire includes no analytics, crash reporting, or tracking, and the default WebRTC transport uses
**no external STUN/TURN servers**, so establishing a session does not contact any third party.

## Hardening recommendations

- Keep your OS, browser, and dependencies up to date.
- Use the **Panic Wipe** button when you are done, and close the session from the admin device.
- Prefer a local network or hotspot you control; avoid untrusted Wi-Fi.
- Do not screen-record or screenshot sensitive sessions.
- Treat every participant as able to retain anything they receive.
