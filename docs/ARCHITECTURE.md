# Architecture

GhostWire is a cross-platform application that provides **serverless, ephemeral, role-based,
end-to-end-encrypted** chat and file sharing over peer-to-peer transports. The same protocol core
runs on the web (PWA) and on native (React Native / Expo).

## Monorepo

```
ghostwire/
├── apps/
│   ├── web/        Next.js 15 PWA — Telegram-style UI, WebRTC, offline service worker
│   ├── native/     Expo app — WebRTC + BLE transports, native QR scanning
│   └── relay/      Optional self-hosted WebSocket relay (hotspot / admin-as-server)
├── packages/
│   ├── crypto/     Ed25519, X25519, AES-256-GCM, HKDF, encodings, random, zeroize
│   ├── protocol/   Envelope + inner message formats, msgpack codec, key ratchet, Zod schemas
│   ├── roles/      Role tokens, delegation certs, verification, permission matrix
│   ├── qr/         QR payload encode/decode, WebRTC bootstrap helpers
│   ├── mesh/       Dedup cache, peer registry, authenticated gossip node
│   └── transport/  Transport interface + WebRTC / WebSocket / in-memory implementations
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Layering rule:** `packages/*` are pure TypeScript — no DOM and no React Native APIs. Only
`packages/transport` and `apps/*` touch platform APIs. This is what lets the protocol, crypto, and
mesh logic be shared verbatim.

Dependency direction:

```
crypto  ◄── protocol ◄── roles
                ▲          ▲
                │          │
    qr ◄──── transport ◄── mesh
                ▲
        apps/web, apps/native, apps/relay
```

## Runtime topology

GhostWire has no central server. The **admin device acts as the hub** — conceptually like a torrent
seeder/coordinator — and peers connect to it directly:

```
        (QR bootstrap)
   ┌──────────┐  offer   ┌───────────┐
   │  Joiner  │◄──────────│           │
   │  device  │  answer  │   ADMIN   │
   └────┬─────┘─────────►│   (hub)   │
        │  WebRTC data   └─────┬─────┘
        │  channel             │
        ▼                      ▼
   ┌──────────┐          ┌──────────┐
   │ Listener │          │ Speaker  │
   └──────────┘          └──────────┘
```

- **Bootstrap:** the host renders an invite QR containing session material and its WebRTC **offer**.
  The joiner scans it, produces an **answer** QR, and the host scans that to complete the channel.
  Non-trickle ICE (with no external STUN) means a single QR each way is enough.
- **Mesh:** every node floods authenticated messages to its peers with a TTL and dedup, so a message
  can hop across intermediate peers when some devices cannot reach the host directly.
- **Hotspot / intranet mode (optional):** the host (native) or any machine can run `apps/relay`; all
  peers open a WebSocket to it. The relay forwards opaque bytes and can never read content. This is
  the "admin device is the server" mode.

## Session lifecycle

1. **Create (admin):** generate `sessionId`, a 256-bit `sessionKey`, an Ed25519 admin keypair, and a
   `sessionStart` timestamp that anchors the key-ratchet schedule. The admin self-issues its admin
   token.
2. **Invite:** the host generates a per-joiner offer QR carrying the session material and the role
   this invite is intended to grant.
3. **Join:** the joiner scans the invite, derives an answer, and once the channel opens sends a
   `join_request` (name + public key).
4. **Approve:** the host issues a signed `role_token` bound to the joiner's key (plus a delegation
   certificate when the role is moderator) and returns it in `join_accept`.
5. **Active:** chat, files, and presence flow through the mesh. Roles are enforced on receipt.
6. **Terminate:** the admin broadcasts a signed `session_close`; every node wipes memory. Any user
   can `panic wipe` locally at any time.

## Key management

- The `sessionKey` arrives **only** through the QR, device to device. It is never sent over the
  network.
- A **symmetric ratchet** derives epoch keys: `k[n] = HKDF(k[n-1], "ghostwire|ratchet|n")`. Epochs
  advance on a wall-clock schedule from `sessionStart`, and old epoch keys are zeroized once outside
  the retention window — giving **forward secrecy** for past messages.
- Each message gets a **per-message key** `HKDF(epochKey, nonce, "ghostwire|msg|<id>")`.
- All keys, tokens, and messages live **in memory only**. On web, session data is never written to
  `localStorage`, `IndexedDB`, cookies, or the Cache API. On native, `expo-secure-store` holds only
  non-sensitive preferences.

## Offline & PWA

- The web app ships a service worker that precaches the shell and caches static assets on first use,
  so it loads and runs fully offline afterwards.
- The manifest declares `display: standalone`, so it is installable on Android, iOS, and desktop.
- No background WebRTC and no push: the app must be open to exchange messages.

## Why pure-JS crypto

`@noble/curves`, `@noble/hashes`, and `@noble/ciphers` are audited, pure-JavaScript implementations.
They run identically in browsers, in React Native, in Node, and in tests. That removes an entire
class of "works on one platform only" bugs and keeps the protocol verifiable.

## Testing

- Unit tests (Vitest) cover crypto round-trips and tamper detection, protocol sealing/opening and
  key-ratchet forward-secrecy properties, role-token verification and delegation chains, QR
  round-trips, mesh delivery/dedup/relay, and transport behaviour.
- Turborepo runs `typecheck`, `test`, and `build` across all packages via CI.

See [`PROTOCOL.md`](./PROTOCOL.md) for the wire format and [`THREAT_MODEL.md`](./THREAT_MODEL.md) for
security claims.
