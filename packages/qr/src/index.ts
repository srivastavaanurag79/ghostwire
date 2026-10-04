import { decode, encode } from "@msgpack/msgpack";
import { decodeUtf8, encodeUtf8, fromBase64Url, toBase64Url } from "@ghostwire/crypto";
import type { RoleToken, Role } from "@ghostwire/protocol";
import { deflateSync, inflateSync } from "fflate";
import { z } from "zod";
import { decodeSdp, encodeSdp } from "./sdp";

export { encodeSdp, decodeSdp } from "./sdp";

/**
 * Human-visible prefix identifying a GhostWire bootstrap payload. Scanners that
 * are not ours can simply ignore anything that does not start with it, and
 * native camera apps will not try to open it as a URL.
 */
export const QR_PREFIX = "GW1:";

/**
 * WebRTC signaling fragment embedded in a bootstrap QR.
 *
 * `sdp` is the plaintext session description; when a payload is encoded the
 * SDP is LZ-compressed into `sdpz` to keep the QR small enough to scan
 * reliably (a raw non-trickle SDP makes a very dense code). Decoding restores
 * `sdp` so consumers never see the difference.
 */
export interface SignalingPayload {
  type: "offer" | "answer";
  /** Non-trickle SDP: gathering is complete, so no separate ICE exchange. */
  sdp?: string;
  /** Compact binary SDP (preferred). */
  sdpc?: Uint8Array;
  /** Deflated SDP text (fallback when the compact codec cannot parse it). */
  sdpz?: Uint8Array;
  /** Shared connection id chosen by the offerer. */
  id?: string;
}

/**
 * Everything needed to join a session. Encoded as msgpack and base64url'd into
 * a single scannable QR. Kept well under 1 KB by using non-trickle SDP.
 */
export interface QRPayload {
  v: 1;
  /** Session id. */
  sid: string;
  /** Role granted by this QR. */
  role: Role;
  /** Session key (AES-256-GCM). */
  sk: Uint8Array;
  /** Admin Ed25519 signing public key. */
  apk: Uint8Array;
  /** Unix ms when the session was created; anchors the key ratchet. */
  st: number;
  /** Optional role credential (moderator/speaker/admin). */
  token?: RoleToken;
  /** Optional WebRTC signaling fragment. */
  sig?: SignalingPayload;
  /** Optional X25519 public key of the issuer for private replies. */
  aek?: Uint8Array;
  /** When set, join via this WebSocket relay instead of WebRTC. */
  relay?: string;
}

const bytes = z.instanceof(Uint8Array);

const signalingSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().optional(),
  sdpc: bytes.optional(),
  sdpz: bytes.optional(),
  id: z.string().optional(),
});

const tokenSchema = z.object({
  v: z.literal(1),
  sid: z.string().min(1),
  name: z.string(),
  pubkey: bytes,
  role: z.enum(["admin", "moderator", "speaker", "listener"]),
  expiry: z.number().int(),
  issuer: bytes,
  signature: bytes,
});

export const qrPayloadSchema = z.object({
  v: z.literal(1),
  sid: z.string().min(1),
  role: z.enum(["admin", "moderator", "speaker", "listener"]),
  sk: bytes,
  apk: bytes,
  st: z.number().int().nonnegative(),
  token: tokenSchema.optional(),
  sig: signalingSchema.optional(),
  aek: bytes.optional(),
  relay: z.string().optional(),
});

/**
 * Trim a session description to the bare minimum needed to establish a single
 * WebRTC data channel. Browsers emit a lot of optional lines and many ICE
 * candidates (including mDNS/`.local`, TCP and reflexive ones); keeping only
 * host UDP candidates and the essential lines shrinks the QR dramatically.
 *
 * QR mode is intended for devices on the same local network, so host
 * candidates are sufficient; use relay mode for NAT traversal.
 */
export function minifySdp(sdp: string): string {
  const essential = [
    "v=",
    "o=",
    "s=",
    "t=",
    "a=group:",
    "a=ice-ufrag:",
    "a=ice-pwd:",
    "a=fingerprint:",
    "a=setup:",
    "a=mid:",
    "a=sctp-port:",
    "a=max-message-size:",
    "m=application",
    "c=",
  ];
  const candidates: string[] = [];
  const output: string[] = [];
  for (const line of sdp.split(/\r\n|\n/)) {
    if (!line) continue;
    if (line.startsWith("a=candidate:")) {
      if (!/\btyp host\b/.test(line)) continue;
      if (/\btcp\b/i.test(line)) continue;
      candidates.push(line);
      continue;
    }
    if (essential.some((prefix) => line.startsWith(prefix))) output.push(line);
  }

  const address = (line: string) => line.split(" ")[4] ?? "";
  const score = (line: string) => {
    const addr = address(line);
    if (addr.includes(".") && !addr.includes(":")) return 1; // IPv4
    if (addr.includes(":")) return 2; // IPv6
    return 3; // hostname / mDNS
  };
  candidates.sort((a, b) => score(a) - score(b));

  const chosen = candidates.slice(0, 2);
  const mIndex = output.findIndex((line) => line.startsWith("m=application"));
  output.splice(mIndex >= 0 ? mIndex + 1 : output.length, 0, ...chosen);
  return `${output.join("\r\n")}\r\n`;
}

/** Compress an SDP into `sdpc`/`sdpz` so the QR stays small enough to scan. */
function packSignaling(sig: SignalingPayload): SignalingPayload {
  if (sig.sdp && !sig.sdpz && !sig.sdpc) {
    const { sdp, ...rest } = sig;
    const compact = encodeSdp(sdp);
    if (compact) return { ...rest, sdpc: compact };
    return { ...rest, sdpz: deflateSync(encodeUtf8(minifySdp(sdp))) };
  }
  return sig;
}

/** Restore `sdp` from `sdpc`/`sdpz` after decoding. */
function unpackSignaling(sig: SignalingPayload | undefined): SignalingPayload | undefined {
  if (!sig || sig.sdp) return sig;
  if (sig.sdpc) {
    const rebuilt = decodeSdp(sig.sdpc);
    if (rebuilt) return { ...sig, sdp: rebuilt };
  }
  if (sig.sdpz) {
    return { ...sig, sdp: decodeUtf8(inflateSync(sig.sdpz)) };
  }
  return sig;
}

/** Encode a payload into a scannable string. */
export function encodeQRPayload(payload: QRPayload): string {
  const clean: QRPayload = {
    v: 1,
    sid: payload.sid,
    role: payload.role,
    sk: payload.sk,
    apk: payload.apk,
    st: payload.st,
  };
  if (payload.token) clean.token = payload.token;
  if (payload.sig) clean.sig = packSignaling(payload.sig);
  if (payload.aek) clean.aek = payload.aek;
  if (payload.relay) clean.relay = payload.relay;
  return QR_PREFIX + toBase64Url(encode(clean));
}

/** Decode a scanned string. Returns null when it is not a GhostWire payload. */
export function tryDecodeQRPayload(text: string): QRPayload | null {
  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith(QR_PREFIX)) return null;
    const bytes = fromBase64Url(trimmed.slice(QR_PREFIX.length));
    const payload = qrPayloadSchema.parse(decode(bytes)) as QRPayload;
    if (payload.sig) payload.sig = unpackSignaling(payload.sig);
    return payload;
  } catch {
    return null;
  }
}

/** Decode a scanned string, throwing when it is invalid. */
export function decodeQRPayload(text: string): QRPayload {
  const payload = tryDecodeQRPayload(text);
  if (!payload) throw new Error("decodeQRPayload: not a GhostWire QR payload");
  return payload;
}

/** Return a copy of the payload carrying an offer/answer fragment. */
export function withSignaling(payload: QRPayload, sig: SignalingPayload): QRPayload {
  return { ...payload, sig };
}

/** Drop the signaling fragment (for static, reusable role QRs). */
export function withoutSignaling(payload: QRPayload): QRPayload {
  const { sig: _sig, ...rest } = payload;
  return rest;
}
