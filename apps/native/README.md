# GhostWire — Native app (Expo / React Native)

The native app is the right tool for **internet-shutdown scenarios**: a phone can run a local
server and a Bluetooth LE mesh, which a browser cannot. This app reuses the exact same protocol,
crypto, roles and mesh packages as the web app.

## Status

| Feature | State |
|---|---|
| Relay + 6-digit PIN join (same relay as web) | ✅ working |
| Roles, approvals, revocation, panic wipe | ✅ working |
| Chat UI (Telegram-style, dark) | ✅ working |
| Bluetooth LE transport core (framing, reassembly, adapter contract) | ✅ implemented |
| BLE session create/join wired into the app | ✅ implemented |
| BLE GATT central plumbing (react-native-ble-plx) | 🚧 needs a dev build |
| BLE advertising/peripheral half (dual-role mesh) | 🚧 needs a peripheral module |
| On-phone relay (`src/server/local-relay.ts`) | 🚧 interface + plan |
| Camera QR scanning / QR rendering | 🚧 planned (payload is shown as text today) |

## Run it

This project is intentionally **standalone** (excluded from the root pnpm workspace) so the web
build and CI stay lean. The shared packages are consumed from their built `dist` output, so build
them first:

```bash
# from the repo root
pnpm install
pnpm build

# then the app
cd apps/native
npm install
npx expo start          # press "a" for Android, "i" for iOS
```

> Use a **development build** (`npx expo run:android` / `eas build`) for Bluetooth. Relay/PIN mode
> works in a plain dev build too.

Set the relay URL in the app to your hosted relay (`wss://…`) or a LAN relay
(`ws://192.168.1.10:8787`) started with:

```bash
pnpm --filter @ghostwire/relay start -- --port 8787
# or serve the app + relay together over the LAN:
pnpm --filter @ghostwire/relay start -- --port 8787 --serve apps/web/out
```

## Why native matters

- **Bluetooth LE mesh**: relay between phones with no internet, no router, no hotspot.
- **On-phone server**: the host phone becomes the relay, so others join with a PIN — no computer.
- These are impossible in a browser, which is why the PWA covers normal/hotspot use and the native
  app covers blackouts.

## Layout

```
apps/native/
├── App.tsx                 # Home / Create / Join / Chat UI
├── src/session.ts          # Native session engine (relay + PIN now; BLE plug-in point)
├── src/transports/ble.ts   # Bluetooth LE transport scaffold
├── metro.config.js         # Monorepo: watches packages/, resolves @ghostwire/* to dist
└── app.json                # Permissions: camera, Bluetooth, local network
```
