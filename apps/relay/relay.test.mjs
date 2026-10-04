import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelay, FRAME_BROADCAST, FRAME_DIRECTED } from "./relay.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

test("relay forwards opaque broadcast frames with a sender header", async () => {
  const relay = createRelay({ port: 0, host: "127.0.0.1" });
  await relay.ready;
  const url = `ws://127.0.0.1:${relay.port}`;

  const a = new WebSocket(url);
  const b = new WebSocket(url);
  await Promise.all([once(a, "open"), once(b, "open")]);

  const payload = Buffer.from("ciphertext-bytes");
  const frame = Buffer.concat([Buffer.from([FRAME_BROADCAST]), payload]);

  const received = new Promise((resolve) => {
    b.on("message", (data, isBinary) => {
      if (isBinary) resolve(Buffer.from(data));
    });
  });

  a.send(frame, { binary: true });
  const got = await received;

  const senderLen = got[0];
  const sender = got.subarray(1, 1 + senderLen).toString("utf8");
  const body = got.subarray(1 + senderLen);
  assert.ok(sender.startsWith("p-"), "sender id present");
  assert.deepEqual(body, payload, "payload forwarded unchanged");

  a.close();
  b.close();
  await relay.close();
});

test("relay delivers directed frames only to the target", async () => {
  const relay = createRelay({ port: 0, host: "127.0.0.1" });
  await relay.ready;
  const url = `ws://127.0.0.1:${relay.port}`;

  const a = new WebSocket(url);
  const b = new WebSocket(url);
  const c = new WebSocket(url);

  let bId = null;
  const bBinaries = [];
  const cBinaries = [];
  b.on("message", (data, isBinary) => {
    if (isBinary) bBinaries.push(Buffer.from(data));
    else {
      const msg = JSON.parse(data.toString());
      if (msg.t === "welcome") bId = msg.id;
    }
  });
  c.on("message", (data, isBinary) => {
    if (isBinary) cBinaries.push(Buffer.from(data));
  });

  await Promise.all([once(a, "open"), once(b, "open"), once(c, "open")]);
  await delay(100);
  assert.ok(bId, "b learned its relay id");

  const target = Buffer.from(bId, "utf8");
  const payload = Buffer.from("for-b-only");
  const frame = Buffer.concat([Buffer.from([FRAME_DIRECTED, target.length]), target, payload]);
  a.send(frame, { binary: true });

  await delay(150);
  assert.equal(bBinaries.length, 1, "target receives the directed frame");
  assert.deepEqual(bBinaries[0].subarray(1 + bBinaries[0][0]), payload);
  assert.equal(cBinaries.length, 0, "non-target does not receive");

  a.close();
  b.close();
  c.close();
  await relay.close();
});
