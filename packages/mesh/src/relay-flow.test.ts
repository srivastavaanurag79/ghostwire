import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { generateSigningKeyPair, timingSafeEqual } from "@ghostwire/crypto";
import { issueRoleToken } from "@ghostwire/roles";
import type { InnerMessage, RoleToken } from "@ghostwire/protocol";
import { WebSocketTransport } from "@ghostwire/transport";
import { MeshNode, type MeshIdentity } from "./index";

// The relay path is exactly what the web app uses in hotspot / relay mode.
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

let server: WebSocketServer;
let port = 0;

beforeAll(async () => {
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  port = (server.address() as { port: number }).port;

  server.on("connection", (socket) => {
    const id = `p-${Math.random().toString(36).slice(2, 8)}`;
    (socket as unknown as { gwId: string }).gwId = id;
    socket.send(JSON.stringify({ t: "welcome", id }));
    for (const client of server.clients) {
      const cid = (client as unknown as { gwId?: string }).gwId;
      if (client !== socket && cid) {
        socket.send(JSON.stringify({ t: "join", id: cid }));
        client.send(JSON.stringify({ t: "join", id }));
      }
    }
    socket.on("message", (raw, isBinary) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const kind = buf[0];
      let target = null;
      let payload;
      if (kind === 0x00) payload = buf.subarray(1);
      else if (kind === 0x01) {
        const len = buf[1];
        target = buf.subarray(2, 2 + len).toString("utf8");
        payload = buf.subarray(2 + len);
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
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sessionId = "relay-session";

function identity(name: string, role: "admin" | "listener", subject: { publicKey: Uint8Array; privateKey: Uint8Array }, issuer: { publicKey: Uint8Array; privateKey: Uint8Array }): MeshIdentity {
  const token: RoleToken = issueRoleToken({
    sessionId,
    name,
    subjectPubkey: subject.publicKey,
    role,
    issuerPrivateKey: issuer.privateKey,
    issuerPubkey: issuer.publicKey,
  });
  return { name, role, token, publicKey: subject.publicKey, privateKey: subject.privateKey };
}

describe("relay end-to-end", () => {
  it("runs the full join + approve + chat flow over a WebSocket relay", async () => {
    const adminKeys = generateSigningKeyPair();
    const guestKeys = generateSigningKeyPair();
    const sessionKey = new Uint8Array(32).fill(4);
    const sessionStart = Date.now() - 1000;

    const hostTransport = new WebSocketTransport(`ws://127.0.0.1:${port}`);
    const guestTransport = new WebSocketTransport(`ws://127.0.0.1:${port}`);
    await Promise.all([hostTransport.open(), guestTransport.open()]);
    await delay(80);

    const hostInbox: InnerMessage[] = [];
    let host: MeshNode;
    let guest: MeshNode;

    host = new MeshNode({
      transport: hostTransport,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey: adminKeys.publicKey,
      identity: identity("Admin", "admin", adminKeys, adminKeys),
      onMessage: (inner) => {
        hostInbox.push(inner);
        if (inner.type === "join_request") {
          const token = issueRoleToken({
            sessionId,
            name: inner.sender.name,
            subjectPubkey: inner.sender.pubkey,
            role: "speaker",
            issuerPrivateKey: adminKeys.privateKey,
            issuerPubkey: adminKeys.publicKey,
          });
          host!.send("join_accept", { token });
        }
      },
    });

    guest = new MeshNode({
      transport: guestTransport,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey: adminKeys.publicKey,
      identity: identity("Guest", "listener", guestKeys, guestKeys),
      onMessage: (inner) => {
        if (inner.type === "join_accept") {
          const token = (inner.body as { token: RoleToken }).token;
          if (timingSafeEqual(token.pubkey, guestKeys.publicKey)) {
            guest!.updateIdentity({ role: token.role, token });
          }
        }
      },
    });

    host.start();
    guest.start();

    guest.send("join_request", { name: "Guest", pubkey: guestKeys.publicKey });
    await delay(120);
    expect(guest.identity.role).toBe("speaker");

    guest.send("chat", { text: "over the relay" });
    await delay(120);
    const chat = hostInbox.find((m) => m.type === "chat");
    expect(chat).toBeDefined();
    expect((chat!.body as { text: string }).text).toBe("over the relay");

    host.stop();
    guest.stop();
    hostTransport.close();
    guestTransport.close();
  });
});
