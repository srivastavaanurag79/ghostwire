import { decode, encode } from "@msgpack/msgpack";
import {
  AES_KEY_BYTES,
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveKey,
  encodeUtf8,
  randomNonce,
  randomUUID,
  sign,
  verify,
  type KeyPair,
} from "@ghostwire/crypto";
import { AAD_PREFIX, DEFAULT_TTL, PROTOCOL_VERSION } from "./constants";
import type { SessionKeyring } from "./keyring";
import type { Envelope, InnerMessage, MessageBody, MessageType, SenderInfo } from "./types";

/** msgpack-encode an arbitrary protocol value to bytes. */
export function pack(value: unknown): Uint8Array {
  return encode(value);
}

/** msgpack-decode bytes back into a protocol value. */
export function unpack<T = unknown>(bytes: Uint8Array): T {
  return decode(bytes) as T;
}

/**
 * Associated data binds the immutable header fields into the AEAD tag so a
 * relay cannot alter the id, timestamp or key epoch. `ttl`/`hops` are
 * intentionally excluded because relays legitimately rewrite them.
 */
export function buildAssociatedData(id: string, ts: number, epoch: number): Uint8Array {
  return encodeUtf8(`${AAD_PREFIX}|${PROTOCOL_VERSION}|${id}|${ts}|${epoch}`);
}

/** Bytes that the sender's Ed25519 signature commits to. */
export function buildSignatureInput(
  id: string,
  ts: number,
  epoch: number,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  const aad = buildAssociatedData(id, ts, epoch);
  const out = new Uint8Array(aad.length + nonce.length + ciphertext.length);
  out.set(aad, 0);
  out.set(nonce, aad.length);
  out.set(ciphertext, aad.length + nonce.length);
  return out;
}

/**
 * Per-message key separation. Each message gets a fresh AES key derived from
 * the current ratchet epoch key, its own random nonce and its unique id, so
 * compromise of a single message key reveals nothing about any other message.
 */
function messageKeyInfo(id: string): string {
  return `ghostwire|msg|${id}`;
}

export interface SealParams {
  keyring: SessionKeyring;
  sender: SenderInfo;
  /** Sender's ephemeral Ed25519 private key. */
  signerPrivateKey: Uint8Array;
  type: MessageType;
  body: MessageBody;
  ttl?: number;
  now?: number;
}

/** Encrypt + sign a message into an opaque wire envelope. */
export function sealEnvelope(params: SealParams): Envelope {
  const { keyring, sender, signerPrivateKey, type, body } = params;
  const now = params.now ?? Date.now();
  const id = randomUUID();
  const ts = now;
  const ttl = params.ttl ?? DEFAULT_TTL;

  if (sender.pubkey.length === 0) {
    throw new Error("sealEnvelope: sender.pubkey is required");
  }

  const epoch = keyring.advanceTo(now);
  const epochKey = keyring.keyAt(epoch);
  if (!epochKey) throw new Error("sealEnvelope: no key for current epoch");

  const inner: InnerMessage = { v: 1, id, type, ts, sender, body };
  const plaintext = pack(inner);
  const nonce = randomNonce();
  const aad = buildAssociatedData(id, ts, epoch);
  const messageKey = deriveKey(epochKey, nonce, messageKeyInfo(id), AES_KEY_BYTES);
  const ciphertext = aesGcmEncrypt(messageKey, plaintext, nonce, aad);
  const signature = sign(
    buildSignatureInput(id, ts, epoch, nonce, ciphertext),
    signerPrivateKey,
  );

  return { v: 1, id, ts, epoch, ttl, hops: 0, nonce, ciphertext, signature };
}

export interface OpenResult {
  inner: InnerMessage;
  /** True when the Ed25519 signature verified against the embedded pubkey. */
  signatureValid: boolean;
}

/**
 * Decrypt and authenticate an envelope.
 *
 * Throws when the epoch is unknown/expired, the AES-GCM tag fails (wrong key,
 * tampered ciphertext) or the plaintext is malformed. Signature validity is
 * reported rather than thrown so callers can apply their own policy.
 */
export function openEnvelope(envelope: Envelope, keyring: SessionKeyring): OpenResult {
  if (envelope.v !== PROTOCOL_VERSION) {
    throw new Error(`openEnvelope: unsupported version ${envelope.v}`);
  }
  const epochKey = keyring.keyAt(envelope.epoch);
  if (!epochKey) {
    throw new Error(`openEnvelope: no key for epoch ${envelope.epoch}`);
  }
  const aad = buildAssociatedData(envelope.id, envelope.ts, envelope.epoch);
  const messageKey = deriveKey(epochKey, envelope.nonce, messageKeyInfo(envelope.id), AES_KEY_BYTES);
  const plaintext = aesGcmDecrypt(messageKey, envelope.ciphertext, envelope.nonce, aad);
  const inner = unpack<InnerMessage>(plaintext);
  if (!inner || inner.v !== 1 || typeof inner.id !== "string" || !inner.sender) {
    throw new Error("openEnvelope: malformed inner message");
  }
  const signatureValid = verify(
    envelope.signature,
    buildSignatureInput(
      envelope.id,
      envelope.ts,
      envelope.epoch,
      envelope.nonce,
      envelope.ciphertext,
    ),
    inner.sender.pubkey,
  );
  return { inner, signatureValid };
}

/** Encode an envelope for the wire (msgpack). */
export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return pack(envelope);
}

/** Decode an envelope received from the wire. */
export function decodeEnvelope(bytes: Uint8Array): Envelope {
  const value = unpack<Envelope>(bytes);
  if (!value || value.v !== PROTOCOL_VERSION) {
    throw new Error("decodeEnvelope: unsupported envelope");
  }
  return value;
}

/** Returns a shallow copy with a decremented hop budget. */
export function forwardEnvelope(envelope: Envelope): Envelope {
  return { ...envelope, ttl: envelope.ttl - 1, hops: envelope.hops + 1 };
}

/** True when the envelope may still be relayed. */
export function isForwardable(envelope: Envelope, maxHops: number): boolean {
  return envelope.ttl > 0 && envelope.hops < maxHops;
}

/** Convenience helper building a signing keypair handle. */
export function signingIdentity(keyPair: KeyPair): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}
