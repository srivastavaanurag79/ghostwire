/**
 * GhostWire relay core (framework-free, importable for tests).
 *
 * Forwards opaque bytes between connected peers. It never has the session key
 * and cannot read message content or sender identity.
 *
 * Framing (client -> server):
 *   broadcast : 0x00 || payload
 *   directed  : 0x01 || targetLen(1) || targetId || payload
 * (server -> client):
 *   binary    : senderLen(1) || senderId || payload
 *   text      : JSON control frame (welcome / join / leave)
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

/**
 * Create and start a relay. Pass `port: 0` to let the OS choose a free port
 * (useful in tests), then read `relay.port`.
 */
export function createRelay({ port = 8787, host = "0.0.0.0", serveDir = null } = {}) {
  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, peers: wss.clients.size }));
      return;
    }
    void serveStatic(serveDir, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer });
  const nextId = nextIdFactory();

  const sendControl = (socket, message) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  wss.on("connection", (socket) => {
    const id = nextId();
    socket.gwId = id;
    socket.isAlive = true;

    sendControl(socket, { t: "welcome", id });
    for (const client of wss.clients) if (client !== socket && client.gwId) sendControl(client, { t: "join", id });
    for (const client of wss.clients) {
      if (client !== socket && client.gwId) sendControl(socket, { t: "join", id: client.gwId });
    }

    socket.on("message", (raw, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buf.length < 1) return;
      const kind = buf[0];
      let payload;
      let targetId = null;
      if (kind === FRAME_BROADCAST) {
        payload = buf.subarray(1);
      } else if (kind === FRAME_DIRECTED) {
        const targetLen = buf[1];
        if (buf.length < 2 + targetLen) return;
        targetId = buf.subarray(2, 2 + targetLen).toString("utf8");
        payload = buf.subarray(2 + targetLen);
      } else {
        return;
      }

      const sender = Buffer.from(id, "utf8");
      const header = Buffer.alloc(1 + sender.length);
      header[0] = sender.length;
      sender.copy(header, 1);
      const frame = Buffer.concat([header, payload]);

      for (const client of wss.clients) {
        if (client === socket) continue;
        if (targetId && client.gwId !== targetId) continue;
        if (client.readyState === WebSocket.OPEN) client.send(frame, { binary: true });
      }
    });

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      for (const client of wss.clients) {
        if (client !== socket && client.gwId) sendControl(client, { t: "leave", id });
      }
    });
  });

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
    httpServer.listen(port, host, () => {
      wss._gwPort = httpServer.address()?.port;
      resolveReady(wss._gwPort);
    });
  });

  return {
    wss,
    httpServer,
    ready,
    get port() {
      return httpServer.address()?.port ?? port;
    },
    async close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      await new Promise((r) => wss.close(() => r()));
      await new Promise((r) => httpServer.close(() => r()));
    },
  };
}
