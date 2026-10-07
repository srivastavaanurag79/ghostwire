import { decodeUtf8, encodeUtf8 } from "@ghostwire/crypto";
import {
  OP_BINARY,
  OP_CLOSE,
  OP_PING,
  OP_PONG,
  OP_TEXT,
  buildUpgradeResponse,
  decodeFrames,
  encodeFrame,
  frameText,
} from "@ghostwire/transport";
import type { RelayRoomConfig } from "@ghostwire/transport";

/**
 * On-phone relay: makes the host phone the "server" with no computer.
 *
 * It speaks the *same* room protocol as `apps/relay` (host/guest/config control
 * frames + the `0x00 broadcast` / `0x01 directed` binary framing), so web peers
 * and native peers interoperate. Other phones join with the 6-digit PIN over the
 * local network / hotspot.
 *
 * A Node `ws` server can't run in React Native, so this uses
 * `react-native-tcp-socket` plus the verified WebSocket codec in
 * `@ghostwire/transport` (`ws-frame`).
 */

const FRAME_BROADCAST = 0x00;
const FRAME_DIRECTED = 0x01;

interface Client {
  id: string;
  pin: string | null;
  handshaken: boolean;
  buffer: Uint8Array;
  socket: SocketLike;
}

interface Room {
  config: RelayRoomConfig | null;
  clients: Set<string>;
}

interface SocketLike {
  write(data: Uint8Array | string, encoding?: string, cb?: () => void): void;
  destroy(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  setNoDelay?(value: boolean): void;
}

interface ServerLike {
  listen(options: { port: number; host?: string }, cb?: () => void): void;
  close(cb?: () => void): void;
}

interface TcpSocketLike {
  createServer(connectionListener: (socket: SocketLike) => void): ServerLike;
}

export interface LocalRelayHandle {
  port: number;
  close(): Promise<void>;
}

export interface StartLocalRelayOptions {
  port?: number;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** react-native-tcp-socket wants a Buffer (or string), not a raw Uint8Array. */
function writeBytes(socket: SocketLike, bytes: Uint8Array): void {
  const B = (globalThis as { Buffer?: { from(data: Uint8Array): unknown } }).Buffer;
  if (B) socket.write(B.from(bytes) as unknown as Uint8Array);
  else socket.write(bytes);
}

/** Start an in-process relay on the phone. Others connect to ws://<lan-ip>:port. */
export async function startLocalRelay(
  options: StartLocalRelayOptions = {},
): Promise<LocalRelayHandle> {
  const tcp = loadTcpSocket();
  const port = options.port ?? 8787;
  const clients = new Map<string, Client>();
  const rooms = new Map<string, Room>();
  let counter = 0;

  const nextId = () => {
    counter = (counter + 1) % 1_000_000;
    return `p-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const sendText = (client: Client, message: unknown): void => {
    writeBytes(client.socket, encodeFrame(encodeUtf8(JSON.stringify(message)), OP_TEXT));
  };
  const sendBinary = (client: Client, bytes: Uint8Array): void => {
    writeBytes(client.socket, encodeFrame(bytes, OP_BINARY));
  };
  const peersOf = (client: Client): Client[] => {
    const room = client.pin ? rooms.get(client.pin) : undefined;
    if (!room) return [];
    return [...room.clients]
      .map((id) => clients.get(id))
      .filter((c): c is Client => Boolean(c) && c !== client);
  };

  function handleControl(client: Client, text: string): void {
    let msg: { t?: string; pin?: string; config?: RelayRoomConfig };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const pin = typeof msg.pin === "string" ? msg.pin : null;

    if (msg.t === "host") {
      if (!pin) return sendText(client, { t: "error", message: "Missing PIN" });
      const room = rooms.get(pin) ?? { config: null, clients: new Set<string>() };
      room.config = msg.config ?? room.config;
      room.clients.add(client.id);
      client.pin = pin;
      rooms.set(pin, room);
      sendText(client, { t: "hosted", pin });
      return;
    }

    if (msg.t === "guest") {
      const room = pin ? rooms.get(pin) : undefined;
      if (!room) return sendText(client, { t: "error", message: "No such session PIN" });
      client.pin = pin;
      for (const peer of peersOf(client)) sendText(peer, { t: "join", id: client.id });
      for (const peer of peersOf(client)) sendText(client, { t: "join", id: peer.id });
      room.clients.add(client.id);
      sendText(client, { t: "config", config: room.config });
    }
  }

  function forwardBinary(client: Client, bytes: Uint8Array): void {
    if (!client.pin || bytes.length < 1) return;
    const kind = bytes[0]!;
    let payload: Uint8Array;
    let target: string | null = null;
    if (kind === FRAME_BROADCAST) {
      payload = bytes.subarray(1);
    } else if (kind === FRAME_DIRECTED) {
      const len = bytes[1]!;
      if (bytes.length < 2 + len) return;
      target = decodeUtf8(bytes.subarray(2, 2 + len));
      payload = bytes.subarray(2 + len);
    } else return;

    const sender = encodeUtf8(client.id);
    const frame = new Uint8Array(1 + sender.length + payload.length);
    frame[0] = sender.length;
    frame.set(sender, 1);
    frame.set(payload, 1 + sender.length);

    for (const peer of peersOf(client)) {
      if (target && peer.id !== target) continue;
      sendBinary(peer, frame);
    }
  }

  function onSocket(socket: SocketLike): void {
    const client: Client = {
      id: nextId(),
      pin: null,
      handshaken: false,
      buffer: new Uint8Array(0),
      socket,
    };
    clients.set(client.id, client);
    socket.setNoDelay?.(true);

    socket.on("data", (raw: unknown) => {
      const chunk = toBytes(raw);
      client.buffer = concat(client.buffer, chunk);

      if (!client.handshaken) {
        const text = safeDecode(client.buffer);
        const end = text.indexOf("\r\n\r\n");
        if (end < 0) return;
        const response = buildUpgradeResponse(text.slice(0, end + 4));
        if (!response) {
          socket.destroy();
          return;
        }
        socket.write(response);
        client.handshaken = true;
        const headerBytes = encodeUtf8(text.slice(0, end + 4));
        client.buffer = client.buffer.subarray(headerBytes.length);
      }

      const { frames, rest } = decodeFrames(client.buffer);
      client.buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === OP_CLOSE) {
          socket.destroy();
          return;
        }
        if (frame.opcode === OP_PING) {
          socket.write(encodeFrame(frame.payload, OP_PONG));
          continue;
        }
        if (frame.opcode === OP_TEXT) {
          const textValue = frameText(frame);
          if (textValue) handleControl(client, textValue);
        } else if (frame.opcode === OP_BINARY) {
          forwardBinary(client, frame.payload);
        }
      }
    });

    socket.on("close", () => {
      clients.delete(client.id);
      const room = client.pin ? rooms.get(client.pin) : undefined;
      if (!room) return;
      room.clients.delete(client.id);
      for (const peer of peersOf(client)) sendText(peer, { t: "leave", id: client.id });
      if (room.clients.size === 0 && client.pin) rooms.delete(client.pin);
    });

    socket.on("error", () => socket.destroy());
  }

  const server = tcp.createServer(onSocket);
  await new Promise<void>((resolve) => server.listen({ port, host: "0.0.0.0" }, () => resolve()));

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients.values()) client.socket.destroy();
        clients.clear();
        rooms.clear();
        server.close(() => resolve());
      }),
  };
}

function toBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === "string") return encodeUtf8(raw);
  return new Uint8Array(raw as ArrayBufferLike);
}

function safeDecode(bytes: Uint8Array): string {
  return decodeUtf8(bytes);
}

function loadTcpSocket(): TcpSocketLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("react-native-tcp-socket") as TcpSocketLike & { default?: TcpSocketLike };
    return (mod.default ?? mod) as TcpSocketLike;
  } catch {
    throw new Error(
      "On-phone relay needs a development build with react-native-tcp-socket installed.",
    );
  }
}
