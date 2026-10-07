import { decodeUtf8, encodeUtf8, fromBase64, sha1, toBase64 } from "@ghostwire/crypto";

/**
 * Minimal RFC 6455 WebSocket codec: the handshake accept-key and frame
 * encode/decode. Used by the on-phone relay (`apps/native`) which cannot run a
 * Node `ws` server, and reusable anywhere a tiny WS server is needed.
 *
 * Only what GhostWire needs is implemented: unfragmented text/binary/control
 * frames, extended lengths, and client mask handling.
 */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OP_CONT = 0x0;
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** RFC 6455 Sec-WebSocket-Accept for a given Sec-WebSocket-Key. */
export function computeAcceptKey(secWebSocketKey: string): string {
  return toBase64(sha1(encodeUtf8(`${secWebSocketKey}${WS_GUID}`)));
}

export interface WsFrame {
  opcode: number;
  payload: Uint8Array;
}

/** Encode a server->client frame (never masked). */
export function encodeFrame(payload: Uint8Array, opcode: number): Uint8Array {
  const length = payload.length;
  let header: Uint8Array;
  if (length < 126) {
    header = new Uint8Array([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = new Uint8Array([0x80 | opcode, 126, (length >> 8) & 0xff, length & 0xff]);
  } else {
    header = new Uint8Array(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    let len = length;
    for (let i = 9; i >= 2; i--) {
      header[i] = len & 0xff;
      len = Math.floor(len / 256);
    }
  }
  const out = new Uint8Array(header.length + length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

export interface DecodeResult {
  frames: WsFrame[];
  /** Unconsumed trailing bytes (partial frame). */
  rest: Uint8Array;
}

/** Decode zero or more frames from a buffer; returns any partial remainder. */
export function decodeFrames(buffer: Uint8Array): DecodeResult {
  const frames: WsFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = (buffer[cursor]! << 8) | buffer[cursor + 1]!;
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = 0;
      for (let i = 0; i < 8; i++) length = length * 256 + buffer[cursor + i]!;
      cursor += 8;
    }
    let maskKey: Uint8Array | null = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      maskKey = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + length > buffer.length) break;
    const payload = buffer.subarray(cursor, cursor + length).slice();
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ maskKey[i % 4]!;
    }
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset).slice() };
}

/** Parse the Sec-WebSocket-Key out of an HTTP upgrade request. */
export function parseUpgradeKey(request: string): string | null {
  const match = /sec-websocket-key:\s*(\S+)/i.exec(request);
  return match ? match[1]! : null;
}

/** Build the 101 Switching Protocols response for an upgrade request. */
export function buildUpgradeResponse(request: string): string | null {
  const key = parseUpgradeKey(request);
  if (!key) return null;
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${computeAcceptKey(key)}`,
    "",
    "",
  ].join("\r\n");
}

/** Decode a masked client text frame's payload as text (best effort). */
export function frameText(frame: WsFrame): string | null {
  try {
    return decodeUtf8(frame.payload);
  } catch {
    return null;
  }
}

// Re-exported for tests.
export { fromBase64 };
