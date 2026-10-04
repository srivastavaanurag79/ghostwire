import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelay, FRAME_BROADCAST, FRAME_DIRECTED } from "./relay.mjs";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

function control(socket, message) {
  socket.send(JSON.stringify(message));
}

test("relay forwards opaque frames within a PIN room", async () => {
  const relay = createRelay({ port: 0, host: "127.0.0.1" });
  await relay.ready;
  const url = `ws://127.0.0.1:${relay.port}`;

  const host = new WebSocket(url);
  const guest = new WebSocket(url);
  const outsider = new WebSocket(url);
  await Promise.all([once(host, "open"), once(guest, "open"), once(outsider, "open")]);

  control(host, { t: "host", pin: "123456", config: { sid: "s", sk: "k", apk: "a", st: 0 } });

  const config = new Promise((resolve) => {
    guest.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.t === "config") resolve(msg.config);
    });
  });
  control(guest, { t: "guest", pin: "123456" });
  const got = await config;
  assert.equal(got.sid, "s");

  await delay(50);

  const guestBytes = [];
  const outsiderBytes = [];
  guest.on("message", (data, isBinary) => isBinary && guestBytes.push(Buffer.from(data)));
  outsider.on("message", (data, isBinary) => isBinary && outsiderBytes.push(Buffer.from(data)));

  const payload = Buffer.from("ciphertext");
  host.send(Buffer.concat([Buffer.from([FRAME_BROADCAST]), payload]), { binary: true });
  await delay(80);

  assert.equal(guestBytes.length, 1, "guest in the room receives");
  assert.deepEqual(guestBytes[0].subarray(1 + guestBytes[0][0]), payload);
  assert.equal(outsiderBytes.length, 0, "outsider not in the room receives nothing");

  host.close();
  guest.close();
  outsider.close();
  await relay.close();
});

test("relay rejects a guest with an unknown PIN", async () => {
  const relay = createRelay({ port: 0, host: "127.0.0.1" });
  await relay.ready;
  const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`);
  await once(socket, "open");
  const error = new Promise((resolve) => {
    socket.on("message", (data, isBinary) => {
      if (!isBinary && JSON.parse(data.toString()).t === "error") resolve(true);
    });
  });
  control(socket, { t: "guest", pin: "000000" });
  assert.equal(await error, true);
  socket.close();
  await relay.close();
});

test("relay supports directed frames within a room", async () => {
  const relay = createRelay({ port: 0, host: "127.0.0.1" });
  await relay.ready;
  const url = `ws://127.0.0.1:${relay.port}`;

  const host = new WebSocket(url);
  const a = new WebSocket(url);
  const b = new WebSocket(url);

  let aId = null;
  a.on("message", (data, isBinary) => {
    if (isBinary) return;
    const msg = JSON.parse(data.toString());
    if (msg.t === "welcome") aId = msg.id;
  });

  await Promise.all([once(host, "open"), once(a, "open"), once(b, "open")]);
  control(host, { t: "host", pin: "999999", config: { sid: "s", sk: "k", apk: "a", st: 0 } });
  control(a, { t: "guest", pin: "999999" });
  control(b, { t: "guest", pin: "999999" });
  await delay(100);
  assert.ok(aId, "a knows its id");

  const aBytes = [];
  const bBytes = [];
  a.on("message", (data, isBinary) => isBinary && aBytes.push(Buffer.from(data)));
  b.on("message", (data, isBinary) => isBinary && bBytes.push(Buffer.from(data)));

  const target = Buffer.from(aId, "utf8");
  const payload = Buffer.from("for-a-only");
  host.send(
    Buffer.concat([Buffer.from([FRAME_DIRECTED, target.length]), target, payload]),
    { binary: true },
  );
  await delay(80);

  assert.equal(aBytes.length, 1, "directed target receives");
  assert.equal(bBytes.length, 0, "other room member does not");

  host.close();
  a.close();
  b.close();
  await relay.close();
});
