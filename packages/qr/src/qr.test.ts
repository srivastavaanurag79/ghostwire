import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, randomBytes } from "@ghostwire/crypto";
import {
  QR_PREFIX,
  decodeQRPayload,
  encodeQRPayload,
  tryDecodeQRPayload,
  withSignaling,
  type QRPayload,
} from "./index";

function samplePayload(): QRPayload {
  return {
    v: 1,
    sid: "s-1",
    role: "listener",
    sk: randomBytes(32),
    apk: generateSigningKeyPair().publicKey,
    st: Date.now(),
  };
}

describe("qr payload", () => {
  it("round-trips", () => {
    const payload = samplePayload();
    const text = encodeQRPayload(payload);
    expect(text.startsWith(QR_PREFIX)).toBe(true);
    const decoded = decodeQRPayload(text);
    expect(decoded.sid).toBe(payload.sid);
    expect(decoded.role).toBe("listener");
    expect(decoded.sk).toEqual(payload.sk);
    expect(decoded.st).toBe(payload.st);
  });

  it("ignores foreign payloads", () => {
    expect(tryDecodeQRPayload("https://example.com")).toBeNull();
    expect(tryDecodeQRPayload(`${QR_PREFIX}not-base64!!!`)).toBeNull();
  });

  it("carries non-trickle signaling", () => {
    const payload = withSignaling(samplePayload(), {
      type: "offer",
      sdp: "v=0...",
      id: "peer-1",
    });
    const decoded = decodeQRPayload(encodeQRPayload(payload));
    expect(decoded.sig?.type).toBe("offer");
    expect(decoded.sig?.id).toBe("peer-1");
  });
});
