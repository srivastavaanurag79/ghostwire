/* GhostWire service worker: offline app shell.
 *
 * Generated at build time by scripts/stamp.mjs — the version below is replaced
 * with the per-build id so every deploy installs a fresh worker and drops the
 * previous caches (a stale cache-first JS chunk is how a device can end up
 * running an old bundle after a deploy).
 *
 * Strategy:
 *  - Precache the shell on install.
 *  - Navigations: network-first, fall back to the cached shell when offline.
 *  - Static assets (same-origin GET): cache-first, then network, and cache the
 *    result for next time. This makes the PWA fully usable offline after the
 *    first visit without ever contacting a third party.
 */
const VERSION = "__GW_VERSION__";
const SHELL = ["/", "/manifest.webmanifest", "/logo.svg", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the version stamp or the worker itself: they are how we detect
  // and roll out new deployments.
  if (url.pathname === "/version.json" || url.pathname === "/sw.js") {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Refresh the offline shell only from the real app entry ("/").
          // Caching every route under "/" would let /chat or /join HTML be
          // served as the homepage, which breaks the in-memory app on reload.
          if (url.pathname === "/") {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        // Offline (or network failure): fall back to the cached app shell.
        .catch(() => caches.match("/")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
