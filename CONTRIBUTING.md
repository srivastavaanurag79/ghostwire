# Contributing to GhostWire

Thanks for your interest in GhostWire. This project is privacy and security tooling, so we ask
contributors to be thoughtful, respectful, and law-abiding. By participating you agree to our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Ground rules

- Be respectful and constructive.
- Keep changes focused and minimal; explain the "why" in your pull request.
- Do not weaken cryptography, remove the no-persistence guarantees, or add trackers/telemetry.
- Do not add anything whose purpose is to enable surveillance, abuse, or harm.
- Never commit secrets, keys, or the local `goal.md` spec (it is git-ignored).

## Development setup

Requirements: Node.js >= 18.18 and pnpm 9.

```bash
corepack enable            # or: npm install -g pnpm@9
pnpm install
pnpm build                 # build all packages
pnpm test                  # run unit tests
pnpm dev                   # run apps in watch mode (web)
```

Run the web app alone:

```bash
pnpm --filter @ghostwire/web dev      # http://localhost:3000
```

## Repository layout

```
apps/
  web/        Next.js 15 PWA (Telegram-style UI)
  native/     React Native (Expo) app for iOS + Android
  relay/      Optional self-hosted WebSocket relay (admin-as-server / hotspot mode)
packages/
  crypto/     Ed25519, X25519, AES-GCM, HKDF, encoding, random
  protocol/   Envelopes, inner messages, key ratchet, msgpack codec, Zod schemas
  roles/      Role tokens, delegation certs, verification, permission matrix
  qr/         QR payload encode/decode and WebRTC bootstrap
  mesh/       Dedup, TTL/gossip, peer registry, authenticated node
  transport/  Transport interface + WebRTC, WebSocket and in-memory transports
```

**Rule:** `packages/*` are pure TypeScript with no DOM and no React Native APIs. Platform-specific
code lives in `apps/*`.

## Coding conventions

- TypeScript strict mode. Avoid `any` in core packages.
- Prefer small, cohesive modules and reuse existing utilities.
- No comments that restate the code; explain non-obvious decisions only.
- Keep the wire format backward-conscious: bump `PROTOCOL_VERSION` and document any break.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a PR.

## Tests

Unit tests live beside the code as `*.test.ts` and run with Vitest:

```bash
pnpm test                       # all packages
pnpm --filter @ghostwire/mesh test
```

Add tests for crypto, verification, mesh behaviour, and any new protocol field.

## Commit style

Use clear, imperative commit messages, for example:

```
feat(mesh): bound rebroadcast by authenticated traffic only
fix(web): keep the joiner on the waiting screen until approved
docs: expand threat model with metadata analysis
```

## Pull requests

1. Fork and branch from `master`.
2. Keep the diff scoped; avoid unrelated formatting churn.
3. Fill in what changed, why, and how you tested it.
4. Ensure CI (typecheck + tests + build) passes.
5. A maintainer will review. Security-sensitive changes get extra scrutiny.

## Reporting security issues

Please do not file public issues for vulnerabilities — see [SECURITY.md](./SECURITY.md).
