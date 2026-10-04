<div align="center">

<img src="apps/web/public/logo.svg" width="112" height="112" alt="GhostWire logo" />

# GhostWire

**Serverless, ephemeral, role-based P2P mesh chat and file sharing — on the web and on native.**

[![License: MIT](https://img.shields.io/badge/License-MIT-2AABEE.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-8774E1.svg)](./CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/Contributor%20Covenant-2.1-4FBE87.svg)](./CODE_OF_CONDUCT.md)

No servers · No accounts · No tracking · End-to-end encrypted · Works offline

</div>

---

GhostWire lets a group of people communicate and share files **without a central server, without
internet, and without leaving a trace** once the session ends. An **admin** device acts as the hub
(think a torrent seeder/coordinator, but for chat): it creates a session, produces invite QR codes,
and peers connect directly over the local network. Messages are end-to-end encrypted, hop across a
multi-hop mesh, and live **only in RAM**.

> **One-line pitch:** a QR-bootstrapped, ephemeral, role-based mesh chat that lives only in memory —
> on web and native.

## Table of contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Features](#features)
- [Roles & permissions](#roles--permissions)
- [Quickstart](#quickstart)
- [Using the app](#using-the-app)
- [Project structure](#project-structure)
- [Packages](#packages)
- [Security & privacy](#security--privacy)
- [Scripts](#scripts)
- [Roadmap](#roadmap)
- [Legal](#legal)
- [Contributing](#contributing)
- [License](#license)

## What it does

- Creates **invite-only sessions** bootstrapped by scanning a QR code — no account, no server.
- Gives every participant a **role** (admin, moderator, speaker, listener) enforced by signed
  credentials.
- Encrypts every **message and file** end-to-end with a session key that never touches the network.
- Relays messages across a **multi-hop peer mesh** with TTL and deduplication.
- Runs as an **installable PWA** that works fully offline after the first load.
- Keeps **nothing on disk** — closing the session or tapping **Panic Wipe** erases everything from
  memory.

## How it works

```
   Admin device (the hub)                         Peers
   ┌────────────────────┐   invite QR (offer)  ┌──────────────┐
   │  create session     │ ───────────────────► │  scan QR     │
   │  session key (RAM)  │   answer QR (answer) │  join        │
   │  role tokens        │ ◄─────────────────── │  get role    │
   └─────────┬──────────┘   WebRTC data channel└──────┬───────┘
             │  authenticated gossip (TTL + dedup)   │
             └─────────────── mesh ──────────────────┘
```

1. **Create.** The admin's device generates a session id, a random 256-bit `sessionKey`, an Ed25519
   signing keypair, and a `sessionStart` timestamp.
2. **Invite.** The admin renders a QR containing the session material and this device's WebRTC
   **offer**. Because GhostWire uses non-trickle ICE with no external STUN/TURN, one QR each way is
   enough — and no third party is ever contacted.
3. **Join.** The joiner scans the invite, shows back an **answer** QR, and the admin scans it. The
   data channel opens. The joiner sends a `join_request` with a display name.
4. **Approve.** The admin issues an Ed25519-signed **role token** bound to the joiner's ephemeral
   key (and a delegation certificate for moderators).
5. **Chat.** Messages are encrypted per-message, signed, and flooded across the mesh. Every node
   verifies signature, token, and role before displaying or relaying.
6. **Terminate.** The admin broadcasts a signed `session_close`; everyone wipes memory. Anyone can
   **Panic Wipe** locally.

There is **no backend at all**. For hotspot/intranet scenarios you can optionally run the tiny
[relay](./apps/relay) so the admin device (or a laptop) literally *is* the server; the relay only
forwards opaque bytes and can never read content.

Read the details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/PROTOCOL.md`](docs/PROTOCOL.md), and [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Features

| | |
|---|---|
| **Zero infrastructure** | No backend, no signaling server, no tracker, no database. |
| **Offline-first PWA** | Service worker caches the shell; installable; works on a local network or hotspot. |
| **End-to-end encryption** | AES-256-GCM with per-message keys; Ed25519 authentication. |
| **Forward secrecy** | A one-way HKDF **key ratchet** rotates keys on a schedule and zeroizes old epochs. |
| **Metadata minimization** | Sender identity is encrypted *inside* the payload; no external STUN; random padding. |
| **Role-based** | Admin, moderator, speaker, listener — signed tokens and delegation certificates. |
| **Mesh routing** | Authenticated gossip with TTL, hop limits, and an LRU dedup cache. |
| **File sharing** | Chunked transfers over the data channel with SHA-256 verification and in-memory buffering. |
| **Ephemeral** | Memory only. Panic wipe zeroizes keys and reloads in one tap. |
| **Cross-platform** | One protocol core shared by web (Next.js PWA) and native (Expo). |

## Roles & permissions

| Role | Read | Send chat/files | Approve speakers | Revoke | Close session |
|---|:---:|:---:|:---:|:---:|:---:|
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Moderator** | ✅ | ✅ | ✅ (only speakers/listeners) | ✅ | ❌ |
| **Speaker** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Listener** | ✅ | ❌ | ❌ | ❌ | ❌ |

- The **admin** holds the root signing key.
- **Moderators** receive a signed **delegation certificate**.
- **Speakers** receive a speaking token bound to their ephemeral key.
- **Listeners** can read only.

## Quickstart

Requirements: **Node.js ≥ 18.18** and **pnpm 9**.

```bash
git clone https://github.com/srivastavaanurag79/ghostwire.git
cd ghostwire
corepack enable            # or: npm install -g pnpm@9
pnpm install
pnpm build
pnpm test
```

### Run the web app

```bash
pnpm --filter @ghostwire/web dev
# open http://localhost:3000
```

To test offline: load the app once, then turn off Wi-Fi and reload — the PWA still opens.

### Deploy the PWA (Vercel)

The web app is fully client-side and **statically exports** to `apps/web/out`, so it deploys as an
installable PWA with no server runtime:

1. Import the repo in Vercel. Leave **Root Directory** at the repository root and set **Framework
   Preset** to `Other`.
2. [`vercel.json`](vercel.json) already sets Install `pnpm install --frozen-lockfile`, Build
   `pnpm exec turbo run build --filter=@ghostwire/web`, and Output `apps/web/out`.
3. Deploy. Open the URL on a phone and choose **Add to Home Screen** / **Install**.

No environment variables, no database, no secrets. Full steps and CLI instructions are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Run the optional relay (hotspot / admin-as-server)

```bash
pnpm --filter @ghostwire/relay start -- --port 8787
# peers connect to ws://<admin-lan-ip>:8787
```

### Coming next: the native app

An Expo (React Native) app for iOS and Android is the next milestone, sharing the same protocol
core. Until then, the PWA is fully functional on both platforms through the browser.

### Build everything

```bash
pnpm build          # turbo: packages + apps
pnpm typecheck
pnpm test
pnpm icons          # regenerate PWA PNGs from the SVG logo
```

## Using the app

### Host a session (admin)

1. Open the web app (or native) and tap **Create a session**.
2. Enter a **display name**. This device becomes the hub.
3. In the **chat** screen, tap **+ Invite someone**.
4. Pick the **role** you want to grant (listener / speaker / moderator) and tap **Generate invite QR**.
5. Show the QR to the person joining. When their **answer QR** appears, scan it with the same dialog.
6. When their **join request** arrives in the sidebar, tap **Approve**.

### Join a session

1. Tap **Join a session**, enter a **display name**, and tap **Scan invite QR**.
2. Scan the host's invite. Your device shows an **answer QR**.
3. Show that QR to the host. Once they scan it and approve, you drop into the chat.

### During a session

- **Send messages** from the composer. Listeners see the composer disabled (read-only).
- **Send files** with the 📎 button (up to 25 MB in memory on web; SHA-256 verified).
- **See who's connected** in the left sidebar, with role badges.
- **Moderate** (admin/moderator): approve or decline join requests, revoke participants.
- **Close the session** (admin) or **Panic Wipe** (anyone) from the sidebar / settings.

### Install as an app

Open the app in a supported browser and use **Add to Home Screen** / **Install**. It runs
standalone and offline afterwards.

## Project structure

```
ghostwire/
├── apps/
│   ├── web/        Next.js 15 PWA (Telegram-style UI) — the working prototype
│   └── relay/      Optional self-hosted WebSocket relay (hotspot / admin-as-server)
├── packages/
│   ├── crypto/     Ed25519, X25519, AES-GCM, HKDF, encodings, random, zeroize
│   ├── protocol/   Envelopes, inner messages, key ratchet, msgpack, Zod schemas
│   ├── roles/      Role tokens, delegation certs, verification, permissions
│   ├── qr/         QR payload encode/decode, WebRTC bootstrap
│   ├── mesh/       Dedup, peer registry, authenticated gossip node
│   └── transport/  Transport interface + WebRTC / WebSocket / in-memory
├── docs/           Architecture, protocol, threat model
├── scripts/        Icon generation, tooling
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Packages

| Package | Description |
|---|---|
| [`@ghostwire/crypto`](packages/crypto) | Pure-JS crypto wrappers over audited `@noble/*` primitives. |
| [`@ghostwire/protocol`](packages/protocol) | Wire types, MessagePack codec, envelope seal/open, key ratchet, Zod schemas. |
| [`@ghostwire/roles`](packages/roles) | Issue/verify role tokens and delegation certs; permission matrix. |
| [`@ghostwire/qr`](packages/qr) | Compact QR payloads and the WebRTC bootstrap handshake. |
| [`@ghostwire/mesh`](packages/mesh) | Transport-agnostic authenticated gossip: dedup, TTL, peer registry. |
| [`@ghostwire/transport`](packages/transport) | Transport interface + WebRTC, WebSocket, and in-memory implementations. |

## Security & privacy

- **Encryption:** AES-256-GCM with a **per-message key** derived from a rotated session key; every
  envelope is Ed25519-signed by the sender's ephemeral key.
- **Forward secrecy:** a one-way HKDF ratchet (`k[n] = HKDF(k[n-1])`) with old epoch keys zeroized.
- **Metadata:** sender identity lives *inside* the ciphertext; the default transport uses **no**
  external STUN/TURN; messages are randomly padded.
- **No persistence:** session data is never written to disk. Panic wipe zeroizes keys in place.
- **No telemetry:** no analytics, crash reporting, or tracking of any kind.

Accepted limitations (read the full [threat model](docs/THREAT_MODEL.md)): a device compromised
*during* a live session, a malicious participant, the admin, and network-level metadata are out of
scope. See [`SECURITY.md`](./SECURITY.md) to report a vulnerability.

**The creator and contributors are not responsible for any misuse of this software.** Read the
[Disclaimer](./DISCLAIMER.md), [Terms and Conditions](./TERMS.md), and [Privacy Policy](./PRIVACY.md).

## Scripts

| Command | Description |
|---|---|
| `pnpm build` | Build all packages and apps with Turborepo. |
| `pnpm dev` | Run apps in watch mode. |
| `pnpm test` | Run unit tests (Vitest) across packages. |
| `pnpm typecheck` | Type-check every workspace. |
| `pnpm icons` | Regenerate PWA icons from the SVG logo. |
| `pnpm --filter @ghostwire/web dev` | Run the web PWA in dev. |
| `pnpm --filter @ghostwire/web build` | Static-export the web PWA to `apps/web/out`. |
| `pnpm --filter @ghostwire/web start` | Serve the exported `out/` locally. |
| `pnpm --filter @ghostwire/relay start` | Run the WebSocket relay. |

## Roadmap

- [x] Monorepo, protocol, crypto, roles, QR, mesh, transports
- [x] Web PWA with Telegram-style UI, offline service worker, icons
- [x] End-to-end encrypted chat, roles, approvals, revocation, panic wipe
- [x] Chunked file sharing with hash verification
- [x] Optional WebSocket relay (hotspot / admin-as-server mode)
- [x] Vercel deployment + CI
- [ ] Native Expo app (WebRTC + Bluetooth LE)
- [ ] Independent security audit
- [ ] Optional message batching to further blunt timing metadata
- [ ] Multi-admin sessions

## Legal

GhostWire is provided **as-is**, without warranty. The creator and contributors are **not
responsible for any misuse** of this repository, web app, native app, or platform. Do not use it to
break the law or harm people. See:

- [DISCLAIMER.md](./DISCLAIMER.md) — no responsibility for misuse, no warranty, limitation of liability.
- [TERMS.md](./TERMS.md) — terms and conditions of use.
- [PRIVACY.md](./PRIVACY.md) — we collect nothing; no servers, no telemetry.
- [SECURITY.md](./SECURITY.md) — how to report a vulnerability.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

```bash
git checkout -b feat/my-change
pnpm typecheck && pnpm test && pnpm build
```

## License

[MIT](./LICENSE) © 2026 Anurag Srivastava.

<div align="center"><sub>Built for short-lived, localized, high-privacy coordination.</sub></div>
