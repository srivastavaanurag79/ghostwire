/**
 * GhostWire relay core (framework-free, importable for tests).
 *
 * This is the "admin device acts as the server" mode. The admin runs this on
 * their machine (or a hotspot host) and opens a room with a short PIN. Peers
 * join the room with the PIN and exchange OPAQUE BYTES through it. The relay
 * forwards bytes and (optionally) hands a joiner the room's session bootstrap;
 * it never sees message plaintext, which is end-to-end encrypted.
 *
 * Rooms are keyed by a short PIN. Optional path prefix (e.g. `/:pin`) is also
 * supported so a plain `ws://host:port/123456` works.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

export const FRAME_BROADCAST = 0x00;
export const FRAME_DIRECTED = 0x01;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function nextIdFactory() {
  let counter = 0;
  return () => {
    counter = (counter + 1) % 1_000_000;
    return `p-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  };
}

async function serveStatic(serveDir, req, res) {
  if (!serveDir) {
    res.writeHead(426, { "content-type": "text/plain" });
    res.end("GhostWire relay: no static directory configured (pass --serve <dir>).");
    return;
  }
  const root = resolve(serveDir);
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let target = filePath;
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
    const data = await readFile(target);
    res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  }
}

export function createRelay({ port = 8787, host = "0.0.0.0", serveDir = null } = {}) {
  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    void serveStatic(serveDir, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer });
  const nextId = nextIdFactory();
  /** pin -> { config, sockets:Set<WebSocket> } */
  const rooms = new Map();

  // Simple per-IP rate limit on room control frames. A 6-digit PIN has only
  // ~20 bits of entropy, so without this an attacker on the network could brute
  // force a PIN and (in PIN-only mode) obtain the session bootstrap.
  const controlAttempts = new Map();
  const CONTROL_WINDOW_MS = 60_000;
  const CONTROL_MAX = 20;
  function allowControl(ip) {
    const now = Date.now();
    const recent = (controlAttempts.get(ip) ?? []).filter((t) => now - t < CONTROL_WINDOW_MS);
    if (recent.length >= CONTROL_MAX) {
      controlAttempts.set(ip, recent);
      return false;
    }
    recent.push(now);
    controlAttempts.set(ip, recent);
    return true;
  }

  const sendTo = (socket, data, binary = false) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary });
  };
  const sendControl = (socket, message) => sendTo(socket, JSON.stringify(message));

  const peersOf = (socket) => {
    const room = rooms.get(socket.gwPin);
    return room ? [...room.sockets].filter((s) => s !== socket) : [];
  };

  wss.on("connection", (socket, req) => {
    socket.gwId = nextId();
    socket.gwPin = null;
    socket.gwIp = req?.socket?.remoteAddress ?? "unknown";
    socket.isAlive = true;
    sendControl(socket, { t: "welcome", id: socket.gwId });

    socket.on("message", (raw, isBinary) => {
      if (!isBinary) {
        handleControl(socket, raw.toString());
        return;
      }
      const room = rooms.get(socket.gwPin);
      if (!room) return;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buf.length < 1) return;
      const kind = buf[0];
      let payload;
      let targetId = null;
      if (kind === FRAME_BROADCAST) payload = buf.subarray(1);
      else if (kind === FRAME_DIRECTED) {
        const len = buf[1];
        if (buf.length < 2 + len) return;
        targetId = buf.subarray(2, 2 + len).toString("utf8");
        payload = buf.subarray(2 + len);
      } else return;

      const sender = Buffer.from(socket.gwId, "utf8");
      const header = Buffer.alloc(1 + sender.length);
      header[0] = sender.length;
      sender.copy(header, 1);
      const frame = Buffer.concat([header, payload]);
      for (const peer of room.sockets) {
        if (peer === socket) continue;
        if (targetId && peer.gwId !== targetId) continue;
        sendTo(peer, frame, true);
      }
    });

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      const room = rooms.get(socket.gwPin);
      if (!room) return;
      room.sockets.delete(socket);
      for (const peer of room.sockets) sendControl(peer, { t: "leave", id: socket.gwId });
      if (room.sockets.size === 0) rooms.delete(socket.gwPin);
    });
  });

  function handleControl(socket, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const pin = typeof msg.pin === "string" ? msg.pin : null;

    if ((msg.t === "host" || msg.t === "guest") && !allowControl(socket.gwIp)) {
      return sendControl(socket, { t: "error", message: "Too many attempts, slow down" });
    }

    if (msg.t === "host") {
      if (!pin) return sendControl(socket, { t: "error", message: "Missing PIN" });
      const existing = rooms.get(pin) ?? { config: null, sockets: new Set() };
      existing.config = msg.config ?? existing.config;
      existing.sockets.add(socket);
      socket.gwPin = pin;
      rooms.set(pin, existing);
      sendControl(socket, { t: "hosted", pin });
      return;
    }

    if (msg.t === "guest") {
      const room = pin ? rooms.get(pin) : null;
      if (!room) return sendControl(socket, { t: "error", message: "No such session PIN" });
      socket.gwPin = pin;
      for (const peer of room.sockets) sendControl(peer, { t: "join", id: socket.gwId });
      for (const peer of room.sockets) {
        if (peer !== socket) sendControl(socket, { t: "join", id: peer.gwId });
      }
      room.sockets.add(socket);
      sendControl(socket, { t: "config", config: room.config });
      return;
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);

  const ready = new Promise((resolveReady) => {
    httpServer.listen(port, host, () => resolveReady(httpServer.address()?.port ?? port));
  });

  return {
    wss,
    httpServer,
    ready,
    get port() {
      return httpServer.address()?.port ?? port;
    },
    get rooms() {
      return rooms.size;
    },
    async close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      await new Promise((r) => wss.close(() => r()));
      await new Promise((r) => httpServer.close(() => r()));
    },
  };
}
