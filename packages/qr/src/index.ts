import { decode, encode } from "@msgpack/msgpack";
import { fromBase64Url, toBase64Url } from "@ghostwire/crypto";
import type { RoleToken, Role } from "@ghostwire/protocol";
import LZString from "lz-string";
import { z } from "zod";

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
  /** LZ-compressed SDP (raw bytes), present on encoded payloads. */
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

/** Compress an SDP into `sdpz` so the QR stays small enough to scan. */
function packSignaling(sig: SignalingPayload): SignalingPayload {
  if (sig.sdp && !sig.sdpz) {
    const { sdp, ...rest } = sig;
    return { ...rest, sdpz: LZString.compressToUint8Array(sdp) };
  }
  return sig;
}

/** Restore `sdp` from `sdpz` after decoding. */
function unpackSignaling(sig: SignalingPayload | undefined): SignalingPayload | undefined {
  if (!sig) return undefined;
  if (!sig.sdp && sig.sdpz) {
    return { ...sig, sdp: LZString.decompressFromUint8Array(sig.sdpz) ?? "" };
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
