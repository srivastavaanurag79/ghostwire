import { decode, encode } from "@msgpack/msgpack";

/**
 * Compact codec for a single-data-channel WebRTC session description.
 *
 * A raw SDP is ~0.7–2.5 KB of text and dominates the QR payload. For our one
 * `m=application webrtc-datachannel` case only a handful of values actually
 * matter, so we parse them into a small tuple and rebuild a minimal, valid SDP
 * on the other side. Typical output is ~90–130 bytes versus ~400+ compressed.
 *
 * If the SDP is anything unusual, `encodeSdp` returns null and callers fall
 * back to sending the (compressed) text.
 */
interface MiniCandidate {
  component: number;
  priority: number;
  address: string;
  port: number;
}

const SETUP_TO_CODE: Record<string, number> = { actpass: 0, active: 1, passive: 2 };
const CODE_TO_SETUP = ["actpass", "active", "passive"];

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const value = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) return null;
    out[i] = value;
  }
  return out;
}

function bytesToHexColon(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

function lineValue(lines: string[], prefix: string): string | null {
  const line = lines.find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function parseCandidate(line: string): MiniCandidate | null {
  const parts = line.split(/\s+/);
  // candidate:<foundation> <component> <transport> <priority> <address> <port> typ host ...
  if (parts.length < 8) return null;
  const component = Number(parts[1]);
  const transport = parts[2];
  const priority = Number(parts[3]);
  const address = parts[4];
  const port = Number(parts[5]);
  const typeIndex = parts.indexOf("typ");
  if (typeIndex < 0 || parts[typeIndex + 1] !== "host") return null;
  if (transport !== "udp") return null;
  if (!Number.isFinite(component) || !Number.isFinite(priority) || !Number.isFinite(port)) {
    return null;
  }
  return { component, priority, address, port };
}

function candidateScore(candidate: MiniCandidate): number {
  if (candidate.address.includes(".") && !candidate.address.includes(":")) return 1; // IPv4
  if (candidate.address.includes(":")) return 2; // IPv6
  return 3; // hostname / mDNS
}

/** Encode an SDP into a compact tuple, or null when it is not a simple datachannel SDP. */
export function encodeSdp(sdp: string): Uint8Array | null {
  try {
    const lines = sdp.split(/\r\n|\n/).filter(Boolean);
    const fingerprintHex = lineValue(lines, "a=fingerprint:sha-256 ");
    const ufrag = lineValue(lines, "a=ice-ufrag:");
    const pwd = lineValue(lines, "a=ice-pwd:");
    const setup = lineValue(lines, "a=setup:");
    if (!fingerprintHex || !ufrag || !pwd || !setup) return null;
    const fingerprint = hexToBytes(fingerprintHex.replace(/:/g, ""));
    if (!fingerprint || fingerprint.length !== 32) return null;

    const setupCode = SETUP_TO_CODE[setup];
    if (setupCode === undefined) return null;

    const mid = lineValue(lines, "a=mid:") ?? "0";
    const sctpPort = Number(lineValue(lines, "a=sctp-port:") ?? "5000");
    const maxMessageSize = Number(lineValue(lines, "a=max-message-size:") ?? "262144");
    const mLine = lines.find((l) => l.startsWith("m=application"));
    const mediaPort = Number(mLine?.split(/\s+/)[1] ?? "9") || 9;

    const candidates = lines
      .filter((l) => l.startsWith("a=candidate:"))
      .map(parseCandidate)
      .filter((c): c is MiniCandidate => c !== null)
      .sort((a, b) => candidateScore(a) - candidateScore(b))
      .slice(0, 2);

    return encode([
      1,
      ufrag,
      pwd,
      fingerprint,
      setupCode,
      mid,
      sctpPort,
      maxMessageSize,
      mediaPort,
      candidates.map((c) => [c.component, c.priority, c.address, c.port]),
    ]);
  } catch {
    return null;
  }
}

/** Rebuild an SDP from `encodeSdp` output. Returns null when the tuple is invalid. */
export function decodeSdp(bytes: Uint8Array): string | null {
  try {
    const value = decode(bytes) as unknown[];
    if (!Array.isArray(value) || value[0] !== 1) return null;
    const [, ufrag, pwd, fingerprint, setupCode, mid, sctpPort, maxMessageSize, mediaPort, rawCandidates] =
      value as [
        number,
        string,
        string,
        Uint8Array,
        number,
        string,
        number,
        number,
        number,
        Array<[number, number, string, number]>,
      ];
    if (typeof ufrag !== "string" || typeof pwd !== "string" || !(fingerprint instanceof Uint8Array)) {
      return null;
    }
    const setup = CODE_TO_SETUP[setupCode];
    if (!setup) return null;

    const out = [
      "v=0",
      "o=- 0 0 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "a=group:BUNDLE 0",
      `m=application ${mediaPort} UDP/DTLS/SCTP webrtc-datachannel`,
      "c=IN IP4 0.0.0.0",
    ];
    (rawCandidates ?? []).forEach(([component, priority, address, port], index) => {
      out.push(
        `a=candidate:${index + 1} ${component} udp ${priority} ${address} ${port} typ host generation 0`,
      );
    });
    out.push(
      `a=ice-ufrag:${ufrag}`,
      `a=ice-pwd:${pwd}`,
      `a=fingerprint:sha-256 ${bytesToHexColon(fingerprint)}`,
      `a=setup:${setup}`,
      `a=mid:${mid}`,
      `a=sctp-port:${sctpPort}`,
      `a=max-message-size:${maxMessageSize}`,
    );
    return `${out.join("\r\n")}\r\n`;
  } catch {
    return null;
  }
}
