import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import type { KeyPair } from "./keys";
import { randomBytes } from "./random";

export const X25519_PUBLIC_KEY_BYTES = 32;
export const X25519_PRIVATE_KEY_BYTES = 32;

/** Generate an X25519 key-agreement keypair. */
export function generateEncryptionKeyPair(): KeyPair {
  const privateKey = randomBytes(X25519_PRIVATE_KEY_BYTES);
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Derive the X25519 public key for a private key. */
export function getEncryptionPublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/** Raw X25519 Diffie-Hellman shared secret (32 bytes). */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(privateKey, peerPublicKey);
}

/**
 * HKDF-SHA256 a shared secret into a symmetric key (defaults to 32 bytes for
 * AES-256). `info` domain-separates different uses of the same handshake.
 */
export function deriveKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array | undefined,
  info: Uint8Array | string,
  length = 32,
): Uint8Array {
  const infoBytes = typeof info === "string" ? new TextEncoder().encode(info) : info;
  return hkdf(sha256, sharedSecret, salt, infoBytes, length);
}
