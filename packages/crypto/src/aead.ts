import { gcm } from "@noble/ciphers/aes";

/** AES-256 key size in bytes. */
export const AES_KEY_BYTES = 32;
/** AES-GCM nonce size in bytes. */
export const AES_NONCE_BYTES = 12;
/** AES-GCM authentication tag size in bytes. */
export const AES_TAG_BYTES = 16;

/**
 * Encrypt with AES-256-GCM.
 *
 * The returned ciphertext already includes the 16-byte authentication tag
 * appended, as produced by `@noble/ciphers`.
 */
export function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  assertKey(key);
  assertNonce(nonce);
  return gcm(key, nonce, aad).encrypt(plaintext);
}

/**
 * Decrypt an AES-256-GCM ciphertext (tag appended). Throws when the tag does
 * not verify or the inputs are malformed.
 */
export function aesGcmDecrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  assertKey(key);
  assertNonce(nonce);
  if (ciphertext.length < AES_TAG_BYTES) {
    throw new Error("aesGcmDecrypt: ciphertext shorter than the authentication tag");
  }
  return gcm(key, nonce, aad).decrypt(ciphertext);
}

function assertKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`aesGcm: key must be ${AES_KEY_BYTES} bytes, got ${key.length}`);
  }
}

function assertNonce(nonce: Uint8Array): void {
  if (nonce.length !== AES_NONCE_BYTES) {
    throw new Error(`aesGcm: nonce must be ${AES_NONCE_BYTES} bytes, got ${nonce.length}`);
  }
}
