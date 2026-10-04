import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { generateSigningKeyPair, randomBytes } from "@ghostwire/crypto";
import { decodeQRPayload, encodeQRPayload, type QRPayload } from "./index";

/** A realistic non-trickle data-channel offer SDP (Chromium-like). */
function realisticSdp(): string {
  const candidates = [
    "candidate:842163049 1 udp 1677729535 192.168.1.42 54321 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag aBcD network-cost 999",
    "candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host generation 0 ufrag aBcD network-cost 999",
    "candidate:2 1 udp 2122194687 fe80::1 54322 typ host generation 0 ufrag aBcD network-cost 999",
    "candidate:3 1 tcp 1518280447 192.168.1.42 9 typ host tcptype active generation 0 ufrag aBcD network-cost 999",
  ];
  return [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=application 54321 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 192.168.1.42",
    ...candidates,
    "a=ice-ufrag:aBcD",
    "a=ice-pwd:c3VwZXItbG9uZy1yYW5kb20tcGFzc3dvcmQ",
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB:0E:5F:0B:8A:0E:1F:0D:6E:6D:C5:32:14",
    "a=setup:actpass",
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "",
  ].join("\r\n");
}

function sampleOffer(): QRPayload {
  return {
    v: 1,
    sid: "b6c0f3e2-1a2b-4c3d-8e4f-1234567890ab",
    role: "listener",
    sk: randomBytes(32),
    apk: generateSigningKeyPair().publicKey,
    st: Date.now(),
    sig: { type: "offer", sdp: realisticSdp(), id: "p-abc123-def456" },
  };
}

/** Render text to an RGBA image the way a phone camera would see it. */
function render(text: string, scale = 4, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "L" });
  const modules = qr.modules;
  const dim = (modules.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (!modules.get(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (y + quiet) * scale + dy;
          const py = (x + quiet) * scale + dx;
          const i = (px * dim + py) * 4;
          data[i] = 14;
          data[i + 1] = 22;
          data[i + 2] = 33;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, dim };
}

describe("QR scannability", () => {
  it("compresses the offer and round-trips the SDP", () => {
    const payload = sampleOffer();
    const encoded = encodeQRPayload(payload);
    expect(encoded.startsWith("GW1:")).toBe(true);

    const decoded = decodeQRPayload(encoded);
    expect(decoded.sig?.type).toBe("offer");
    expect(decoded.sig?.sdp).toBe(payload.sig!.sdp);
  });

  it("produces a QR that jsQR can decode", () => {
    const encoded = encodeQRPayload(sampleOffer());
    const qr = QRCode.create(encoded, { errorCorrectionLevel: "L" });
    // eslint-disable-next-line no-console
    console.log(
      `[qr] encoded=${encoded.length} chars, raw sdp=${realisticSdp().length} bytes, modules=${qr.modules.size}`,
    );
    expect(encoded.length).toBeLessThan(2200);

    const { data, dim } = render(encoded, 6, 4);
    const result = jsQR(data, dim, dim, { inversionAttempts: "attemptBoth" });
    expect(result).not.toBeNull();
    expect(result!.data).toBe(encoded);
  });
});
