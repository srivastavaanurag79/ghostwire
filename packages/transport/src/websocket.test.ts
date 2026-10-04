import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketTransport } from "./websocket";

// React Native and browsers provide a global WebSocket; Node does not, so the
// test injects the `ws` implementation before constructing a transport.
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

const FRAME_BROADCAST = 0x00;
const FRAME_DIRECTED = 0x01;

let server: WebSocketServer;
let port = 0;

/** A tiny relay that speaks the exact same framing as apps/relay. */
beforeAll(async () => {
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  port = (server.address() as { port: number }).port;

  server.on("connection", (socket) => {
    const id = `peer-${Math.random().toString(36).slice(2, 7)}`;
    (socket as unknown as { gwId: string }).gwId = id;
    socket.send(JSON.stringify({ t: "welcome", id }));
    for (const client of server.clients) {
      const cid = (client as unknown as { gwId?: string }).gwId;
      if (client !== socket && cid) socket.send(JSON.stringify({ t: "join", id: cid }));
      if (client !== socket && cid) client.send(JSON.stringify({ t: "join", id }));
    }
    socket.on("message", (raw, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const kind = buf[0];
      let target: string | null = null;
      let payload: Buffer;
      if (kind === FRAME_BROADCAST) payload = buf.subarray(1) as Buffer;
      else if (kind === FRAME_DIRECTED) {
        const len = buf[1];
        target = buf.subarray(2, 2 + len).toString("utf8");
        payload = buf.subarray(2 + len) as Buffer;
      } else return;
      const sender = Buffer.from(id, "utf8");
      const header = Buffer.alloc(1 + sender.length);
      header[0] = sender.length;
      sender.copy(header, 1);
      const frame = Buffer.concat([header, payload]);
      for (const client of server.clients) {
        const cid = (client as unknown as { gwId?: string }).gwId;
        if (client === socket) continue;
        if (target && cid !== target) continue;
        client.send(frame, { binary: true });
      }
    });
    socket.on("close", () => {
      for (const client of server.clients) {
        if (client !== socket) client.send(JSON.stringify({ t: "leave", id }));
      }
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("WebSocketTransport", () => {
  it("connects through a relay and exchanges broadcast + directed bytes", async () => {
    const a = new WebSocketTransport(`ws://127.0.0.1:${port}`);
    const b = new WebSocketTransport(`ws://127.0.0.1:${port}`);
    await Promise.all([a.open(), b.open()]);
    await waitFor(() => a.peerIds.length > 0 && b.peerIds.length > 0);

    const fromB = new Promise<{ from: string; data: number[] }>((resolve) => {
      b.onMessage((from, data) => resolve({ from, data: [...data] }));
    });
    a.broadcast(new Uint8Array([1, 2, 3]));
    const received = await fromB;
    expect(received.data).toEqual([1, 2, 3]);

    // Directed send: a -> b only.
    const bId = a.peerIds[0]!;
    const directed = new Promise<number[]>((resolve) => {
      b.onMessage((_from, data) => resolve([...data]));
    });
    a.send(bId, new Uint8Array([9, 8, 7]));
    expect(await directed).toEqual([9, 8, 7]);

    a.close();
    b.close();
  });

  it("opens a PIN room and hands the config to a joiner", async () => {
    const roomServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => roomServer.once("listening", () => resolve()));
    const roomPort = (roomServer.address() as { port: number }).port;
    const configs = new Map<string, unknown>();

    roomServer.on("connection", (socket) => {
      const id = `r-${Math.random().toString(36).slice(2, 7)}`;
      (socket as unknown as { gwId: string }).gwId = id;
      socket.send(JSON.stringify({ t: "welcome", id }));
      socket.on("message", (raw, isBinary) => {
        if (isBinary) return;
        const msg = JSON.parse(raw.toString());
        if (msg.t === "host") {
          configs.set(msg.pin, msg.config);
          socket.send(JSON.stringify({ t: "hosted", pin: msg.pin }));
        } else if (msg.t === "guest") {
          const config = configs.get(msg.pin);
          if (config) socket.send(JSON.stringify({ t: "config", config }));
          else socket.send(JSON.stringify({ t: "error", message: "no room" }));
        }
      });
    });

    const host = new WebSocketTransport(`ws://127.0.0.1:${roomPort}`);
    await host.open();
    await host.host("123456", { sid: "s-1", sk: "k", apk: "a", st: 123 });

    const guest = new WebSocketTransport(`ws://127.0.0.1:${roomPort}`);
    await guest.open();
    const config = await guest.join("123456");
    expect(config.sid).toBe("s-1");
    expect(config.st).toBe(123);

    await expect(guest.join("000000")).rejects.toThrow();

    host.close();
    guest.close();
    await new Promise<void>((resolve) => roomServer.close(() => resolve()));
  });
});
