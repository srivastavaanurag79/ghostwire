import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { sha1 } from "@noble/hashes/sha1";
import { hmac } from "@noble/hashes/hmac";
import { hkdf } from "@noble/hashes/hkdf";

export { sha256, sha512, sha1, hmac, hkdf };

/** SHA-256 digest of `data`. */
export function hash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/** Hex-encoded SHA-256 digest — convenient for fingerprints and file hashes. */
export function hashToHex(data: Uint8Array): string {
  return Array.from(sha256(data), (b) => b.toString(16).padStart(2, "0")).join("");
}
