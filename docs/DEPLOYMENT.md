# Deployment

## Vercel (recommended for the PWA)

GhostWire's web app is a fully static client-side Next.js app: no API routes, no database, no
server-side secrets. It deploys to Vercel and becomes an installable PWA over HTTPS (which also
enables camera QR scanning).

### One-time setup

1. Push the repository to GitHub (already done for the upstream repo).
2. In Vercel, **Add New → Project** and import the repository.
3. Configure the project:
   - **Root Directory:** `apps/web`
   - **Framework Preset:** Next.js (auto-detected)
   - **Build Command:** `pnpm exec turbo run build --filter=@ghostwire/web`
   - **Install Command:** `pnpm install --frozen-lockfile`
   - **Node.js:** 20.x
   - Leave "Include source files outside of the Root Directory in the Build Step" enabled
     (Vercel enables this for pnpm/Turborepo workspaces).
4. Deploy.

> **Why the Turborepo build command?** The web app imports the workspace packages
> (`@ghostwire/protocol`, etc.), which must be compiled first. `turbo run build --filter=@ghostwire/web`
> builds those dependencies and then the web app, in the correct order.

> **Production branch.** This repository's default branch is `master`. In
> **Project Settings → Git → Production Branch**, set it to `master` (or rename the default branch to
> `main` on GitHub) so pushes deploy to production.

A ready-made [`apps/web/vercel.json`](../apps/web/vercel.json) already pins the framework, install
and build commands.

### After deploy

- Open the URL on a phone. The install prompt (Android/desktop) or **Add to Home Screen** (iOS)
  installs GhostWire as a standalone PWA.
- Load it once online so the service worker caches the shell; afterwards it opens offline.

### Notes

- **No environment variables** are required. There is nothing to configure and no secrets to add.
- The default **Direct QR** mode needs no infrastructure: two devices on the same network or
  hotspot connect peer-to-peer after scanning each other's QR codes.
- Vercel's servers only serve the static app; they never see messages, keys, or participants.

## Self-hosting (optional)

Because the app is static, any static host works (Netlify, Cloudflare Pages, GitHub Pages, an
S3 bucket, or `apps/relay` with `--serve`). Requirements:

- Serve over **HTTPS** (or `localhost`) so the camera and service worker are available.
- Correct MIME types for `.webmanifest` and `.js`.

Build the static output:

```bash
pnpm build
pnpm --filter @ghostwire/web start   # or deploy the .next output
```

To serve the built app **and** the relay from one machine on a hotspot:

```bash
pnpm --filter @ghostwire/relay start -- --port 8787 --serve <path-to-static-build>
```

## Relay mode (hotspot / intranet)

The relay is a tiny Node process. Run it on the admin's device or any machine on the local network:

```bash
pnpm --filter @ghostwire/relay start -- --port 8787
# peers use ws://<lan-ip>:8787 as the relay URL when creating/joining a relay session
```

The relay only forwards opaque bytes. It never holds the session key and cannot read content.

## Native app

The Expo app is the next milestone and is not required to use GhostWire today — the PWA is fully
functional on Android and iOS via the browser. See the roadmap in the [README](../README.md).
