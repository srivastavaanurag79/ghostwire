import { describe, expect, it } from "vitest";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  decodeUtf8,
  deriveKey,
  deriveSharedSecret,
  encodeUtf8,
  fromBase64Url,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  randomBytes,
  randomNonce,
  randomUUID,
  sign,
  timingSafeEqual,
  toBase64Url,
  verify,
  zeroize,
} from "./index";

describe("signing", () => {
  it("signs and verifies", () => {
    const pair = generateSigningKeyPair();
    const message = encodeUtf8("hello ghostwire");
    const signature = sign(message, pair.privateKey);
    expect(verify(signature, message, pair.publicKey)).toBe(true);
    expect(verify(signature, encodeUtf8("tampered"), pair.publicKey)).toBe(false);
  });

  it("rejects signatures from another key", () => {
    const a = generateSigningKeyPair();
    const b = generateSigningKeyPair();
    const message = encodeUtf8("x");
    expect(verify(sign(message, a.privateKey), message, b.publicKey)).toBe(false);
  });
});

describe("key agreement", () => {
  it("derives the same shared secret on both sides", () => {
    const a = generateEncryptionKeyPair();
    const b = generateEncryptionKeyPair();
    const ab = deriveSharedSecret(a.privateKey, b.publicKey);
    const ba = deriveSharedSecret(b.privateKey, a.publicKey);
    expect(timingSafeEqual(ab, ba)).toBe(true);
  });

  it("hkdf is deterministic", () => {
    const secret = randomBytes(32);
    const salt = randomBytes(16);
    expect(timingSafeEqual(deriveKey(secret, salt, "info"), deriveKey(secret, salt, "info"))).toBe(
      true,
    );
  });
});

describe("aead", () => {
  it("round-trips", () => {
    const key = randomBytes(32);
    const nonce = randomNonce();
    const plaintext = encodeUtf8("secret message");
    const ct = aesGcmEncrypt(key, plaintext, nonce);
    expect(decodeUtf8(aesGcmDecrypt(key, ct, nonce))).toBe("secret message");
  });

  it("detects tampering", () => {
    const key = randomBytes(32);
    const nonce = randomNonce();
    const ct = aesGcmEncrypt(key, encodeUtf8("secret"), nonce);
    ct[0] = ct[0]! ^ 0xff;
    expect(() => aesGcmDecrypt(key, ct, nonce)).toThrow();
  });

  it("detects wrong associated data", () => {
    const key = randomBytes(32);
    const nonce = randomNonce();
    const ct = aesGcmEncrypt(key, encodeUtf8("secret"), nonce, encodeUtf8("aad-a"));
    expect(() => aesGcmDecrypt(key, ct, nonce, encodeUtf8("aad-b"))).toThrow();
  });
});

describe("encoding & random", () => {
  it("base64url round-trips", () => {
    const bytes = randomBytes(50);
    expect(timingSafeEqual(fromBase64Url(toBase64Url(bytes)), bytes)).toBe(true);
  });

  it("uuid v4 shape", () => {
    expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("zeroize clears a buffer", () => {
    const buf = randomBytes(16);
    zeroize(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});
