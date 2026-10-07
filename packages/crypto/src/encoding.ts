import { base64, base64urlnopad, hex } from "@scure/base";

/**
 * Pure-JS UTF-8 codec.
 *
 * `TextEncoder`/`TextDecoder` are not available in every runtime (notably
 * Hermes/React Native), so we implement encoding directly. This keeps every
 * package (crypto, protocol, qr, transport) portable with no polyfills.
 */
export function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Decode UTF-8 bytes to a string (invalid sequences become U+FFFD). */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = (bytes[i++] ?? 0) & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = (bytes[i++] ?? 0) & 0x3f;
      const b2 = (bytes[i++] ?? 0) & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else {
      const b1 = (bytes[i++] ?? 0) & 0x3f;
      const b2 = (bytes[i++] ?? 0) & 0x3f;
      const b3 = (bytes[i++] ?? 0) & 0x3f;
      let cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

/** Standard base64 (with padding). */
export function toBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

export function fromBase64(value: string): Uint8Array {
  return base64.decode(value);
}

/** URL-safe base64 without padding — used inside QR payloads. */
export function toBase64Url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

export function fromBase64Url(value: string): Uint8Array {
  return base64urlnopad.decode(value);
}

export function toHex(bytes: Uint8Array): string {
  return hex.encode(bytes);
}

export function fromHex(value: string): Uint8Array {
  return hex.decode(value);
}
