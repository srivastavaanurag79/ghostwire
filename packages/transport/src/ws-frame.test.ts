import { describe, expect, it } from "vitest";
import {
  OP_BINARY,
  OP_TEXT,
  buildUpgradeResponse,
  computeAcceptKey,
  decodeFrames,
  encodeFrame,
  parseUpgradeKey,
} from "./ws-frame";

function maskFrame(payload: Uint8Array, opcode: number): Uint8Array {
  const mask = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
  const masked = payload.slice();
  for (let i = 0; i < masked.length; i++) masked[i] = masked[i]! ^ mask[i % 4]!;
  const header = new Uint8Array([0x80 | opcode, 0x80 | payload.length, ...mask]);
  const out = new Uint8Array(header.length + masked.length);
  out.set(header, 0);
  out.set(masked, header.length);
  return out;
}

describe("ws-frame", () => {
  it("computes the RFC 6455 accept key", () => {
    expect(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("builds an upgrade response from a request", () => {
    const request =
      "GET / HTTP/1.1\r\nHost: x\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
    expect(parseUpgradeKey(request)).toBe("dGhlIHNhbXBsZSBub25jZQ==");
    const response = buildUpgradeResponse(request);
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("encodes server frames (small and extended) and decodes client frames", () => {
    const small = encodeFrame(new Uint8Array([1, 2, 3]), OP_BINARY);
    expect(small[0]).toBe(0x80 | OP_BINARY);
    expect(small[1]).toBe(3);

    const big = new Uint8Array(300).fill(7);
    const bigFrame = encodeFrame(big, OP_BINARY);
    expect(bigFrame[1]).toBe(126);

    // Decode a masked client text frame.
    const client = maskFrame(new TextEncoder().encode('{"t":"host"}'), OP_TEXT);
    const { frames, rest } = decodeFrames(client);
    expect(rest.length).toBe(0);
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe('{"t":"host"}');
  });

  it("handles partial frames via the remainder", () => {
    const client = maskFrame(new Uint8Array([1, 2, 3, 4, 5]), OP_BINARY);
    const partial = client.subarray(0, client.length - 2);
    const first = decodeFrames(partial);
    expect(first.frames).toHaveLength(0);
    expect(first.rest.length).toBe(partial.length);

    const combined = new Uint8Array(first.rest.length + 2);
    combined.set(first.rest, 0);
    combined.set(client.subarray(client.length - 2), first.rest.length);
    const second = decodeFrames(combined);
    expect(second.frames).toHaveLength(1);
    expect([...second.frames[0]!.payload]).toEqual([1, 2, 3, 4, 5]);
  });
});
