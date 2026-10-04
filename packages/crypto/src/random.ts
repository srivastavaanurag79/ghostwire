import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils";

/** Cryptographically secure random bytes. */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`randomBytes: invalid length ${length}`);
  }
  return nobleRandomBytes(length);
}

/** 96-bit nonce, the recommended size for AES-GCM. */
export function randomNonce(): Uint8Array {
  return nobleRandomBytes(12);
}

/**
 * RFC 4122 version 4 UUID generated from a CSPRNG.
 *
 * Implemented locally so the core does not depend on `crypto.randomUUID`,
 * which is missing from some React Native runtimes.
 */
export function randomUUID(): string {
  const bytes = nobleRandomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
