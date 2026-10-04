# Deployment

## Vercel (recommended for the PWA)

GhostWire's web app is a fully client-side Next.js app that **statically exports** to `apps/web/out`.
It has no API routes, no database, no server-side secrets, and no environment variables. Deploying it
is a static-file upload to Vercel's CDN, and it becomes an installable PWA over HTTPS (which also
enables camera QR scanning).

### Why a static export?

It removes monorepo root-directory complexity: the build runs once from the repository root, compiles
the workspace packages, and emits a plain `out/` folder. The same folder can be served by Vercel, any
static host, or the included relay.

### One-time setup

1. Import the repository in Vercel (**Add New → Project**).
2. Configure the project:
   - **Root Directory:** leave at the repository root (do **not** set `apps/web`)
   - **Framework Preset:** `Other`
   - **Node.js Version:** `20.x`
   - Install/Build/Output come from the repo-root [`vercel.json`](../vercel.json):
     - Install: `pnpm install --frozen-lockfile`
     - Build: `pnpm exec turbo run build --filter=@ghostwire/web`
     - Output: `apps/web/out`
3. **Settings → Git → Production Branch:** `master` (this repo's default branch).
4. Deploy.

### Deploy from the CLI

Run these from the **repository root** (not from `apps/web`), so the whole workspace is uploaded:

```powershell
cd C:\Users\sriva\vedifie\personal\ghostwire
Remove-Item -Recurse -Force .\apps\web\.vercel -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\.vercel -ErrorAction SilentlyContinue

vercel link --yes --project ghostwire --scope <your-team-slug>
vercel --prod
```

> **Important:** linking from `apps/web` uploads only that folder, which breaks the install (no
> lockfile, no `packages/*`). Always link and deploy from the repository root.

### After deploy

- Open the URL on a phone and use the install prompt / **Add to Home Screen**. It runs standalone and
  offline after the first load (service worker caches the shell).
- No environment variables are needed. Vercel only serves static files and never sees messages, keys,
  or participants.

### Build locally

```bash
pnpm exec turbo run build --filter=@ghostwire/web   # emits apps/web/out
pnpm --filter @ghostwire/web start                  # serves out/ on http://localhost:3000
```

## Self-hosting (optional)

The exported `apps/web/out` is plain static files, so any host works (Netlify, Cloudflare Pages,
GitHub Pages, an S3 bucket, or the relay). Requirements:

- Serve over **HTTPS** (or `localhost`) so the camera and service worker are available.
- Correct MIME type for `.webmanifest`.

To serve the built app **and** the relay from one machine on a hotspot:

```bash
pnpm --filter @ghostwire/relay start -- --port 8787 --serve apps/web/out
```

## Relay mode (hotspot / intranet)

The relay is a tiny Node process. Run it on the admin's device or any machine on the local network:

```bash
pnpm --filter @ghostwire/relay start -- --port 8787
# peers use ws://<lan-ip>:8787 as the relay URL when creating/joining a relay session
```

The relay only forwards opaque bytes. It never holds the session key and cannot read content.

## Host the relay online (so PIN joins work from the Vercel PWA)

An HTTPS page cannot open a `ws://` relay (mixed content). To let people **join by PIN** from your
deployed HTTPS app, host the relay once and use its `wss://` URL.

**Render (free tier, easiest):** the repo ships [`render.yaml`](../render.yaml). In Render →
**New → Blueprint**, point it at this repo. Render builds `apps/relay` and gives you a URL like
`wss://ghostwire-relay.onrender.com`.

**Any Node host (Fly.io, Railway, a VPS):** build [`apps/relay/Dockerfile`](../apps/relay/Dockerfile)
or run `node apps/relay/server.mjs --port $PORT --host 0.0.0.0`. Expose one port; TLS termination at
the platform gives you `wss://`.

Then, on Vercel, set an environment variable and redeploy:

```
NEXT_PUBLIC_RELAY_URL = wss://ghostwire-relay.onrender.com
```

Now the app prefills the relay URL, and joining is just: **Join a session → name → Join with a PIN →
enter the 6-digit PIN**. No QR, no second handshake. The admin still sees a PIN and an optional QR
in the invite panel.

> Security note: for PIN joins the relay hands the session bootstrap (session key) to joiners, so
> the relay must be **yours/trusted**. For untrusted relays, share the invite QR/link instead, which
> carries the session material out-of-band and never exposes it to the relay.

## Serve the app and relay offline (no internet at all)

```bash
pnpm build
pnpm --filter @ghostwire/relay start -- --port 8787 --serve apps/web/out
# open http://<lan-ip>:8787 on every device; install the PWA from there
```

Everything (app + signaling + messaging) then runs on the local network/hotspot with no internet.

## Native app

The Expo app is the next milestone and is not required to use GhostWire today — the PWA is fully
functional on Android and iOS via the browser. See the roadmap in the [README](../README.md).
