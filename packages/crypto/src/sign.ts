import { ed25519 } from "@noble/curves/ed25519";
import type { KeyPair } from "./keys";
import { randomBytes } from "./random";

export const ED25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_PRIVATE_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

/** Generate an Ed25519 signing keypair. */
export function generateSigningKeyPair(): KeyPair {
  const privateKey = randomBytes(ED25519_PRIVATE_KEY_BYTES);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Derive the public key for an Ed25519 private key. */
export function getSigningPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

/** Sign `message` with an Ed25519 private key. Returns a 64-byte signature. */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/** Verify an Ed25519 signature. Never throws for invalid signatures. */
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== ED25519_SIGNATURE_BYTES) return false;
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) return false;
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
