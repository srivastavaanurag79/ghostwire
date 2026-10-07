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
| Bluetooth LE transport core (framing, reassembly, adapter contract) | ✅ implemented + CI tests (fake adapter) |
| BLE session create/join wired into the app | ✅ implemented |
| BLE GATT central (react-native-ble-plx: scan/connect/notify/write) | ✅ implemented |
| Camera QR: invite render + scan | ✅ implemented |
| On-phone relay (`startLocalRelay`) + WebSocket codec | ✅ implemented |
| File sharing (pick / chunk / verify / save) | ✅ implemented |
| Moderation UI (approve / decline / revoke) | ✅ implemented |
| BLE advertising/peripheral half + dual-role adapter | ✅ implemented |
| BLE dual-role mesh on real radios | 🚧 needs a dev build + `react-native-ble-peripheral` |

## BLE operational notes (from a design review)

- **Throughput**: ~1–5 KB/s per link after MTU/fragmentation — fine for chat, painful for files. File sharing is optimised for relay/WebRTC; over BLE expect slow transfers.
- **Roles**: every node advertises and scans (dual-role). Android supports ~7–10 simultaneous links, iOS ~7–8.
- **Fragmentation**: `[total:1][index:1][payload]` chunks, reassembled per peer in `BleTransport` (GATT writes are ordered/reliable).
- **Background**: iOS `bluetooth-central`/`bluetooth-peripheral` background modes are declared; Android declares `FOREGROUND_SERVICE_CONNECTED_DEVICE`. Treat real-time mesh as foreground-first.
- **Future**: split into a small control channel over BLE and a bulk channel over WebRTC/relay for files.

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

## Build an APK / dev build

Bluetooth and the on-phone relay are **native modules**, so Expo Go cannot run them — you need a
development build or a standalone APK.

**Option A — cloud APK (recommended; no local SDK/JDK needed).** Uses [`eas.json`](./eas.json):

```bash
cd apps/native
npm install
npx eas-cli login            # free Expo account
npx eas-cli build -p android --profile preview   # produces a downloadable .apk
```

Install that APK on **two physical phones** and test the Bluetooth mesh. (An emulator has no
Bluetooth radio.) `--profile development` builds a dev-client APK instead.

**Releases.** Tagging `v*` (or running the workflow manually) triggers
[`release-apk.yml`](../../.github/workflows/release-apk.yml), which builds the arm64 release APK and
attaches it to the GitHub Release as `ghostwire.apk`. The web app links to
`releases/latest/download/ghostwire.apk`, so the binary lives in Releases, not in git history.

**Option B — local build.** Requires the Android SDK (you have it: `%ANDROID_HOME%`) **and JDK 17**
(Expo SDK 51 / RN 0.74 do not build with JDK 11):

```bash
cd apps/native
npm install
npx expo run:android          # builds + installs a debug dev build to a USB device/emulator
# adb lives at %ANDROID_HOME%\platform-tools\adb.exe (not on PATH)
```

**Emulator.** `%ANDROID_HOME%\emulator\emulator.exe -avd Medium_Phone_API_35`. Useful for UI,
relay + PIN, and WebRTC over the network — **not** for BLE.

**What needs a second physical phone:** only the Bluetooth LE mesh. Everything else (relay + PIN,
WebRTC, file sharing, moderation) can be exercised with one phone + emulator, or two browsers.



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
