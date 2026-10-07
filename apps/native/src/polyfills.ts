/**
 * Hermes polyfills.
 *
 * Hermes (React Native) does not provide `TextEncoder` / `TextDecoder`, but
 * several dependencies use them at import time — notably `@msgpack/msgpack`
 * (`new TextEncoder()` at module load) and `@noble/hashes` / `@scure/base`
 * (utf8 helpers). Without a polyfill the app crashes on launch with
 * "Property 'TextDecoder' doesn't exist".
 *
 * This must be imported before any such dependency, so it is the first import
 * in `index.js`.
 */
type MutableGlobal = typeof globalThis & {
  TextEncoder?: unknown;
  TextDecoder?: unknown;
};

function encodeUtf8(value: string): Uint8Array {
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
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
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

function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 >= 0xc0 && b0 < 0xe0) {
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

const g = globalThis as MutableGlobal;

if (typeof g.TextEncoder === "undefined") {
  class GhostWireTextEncoder {
    readonly encoding = "utf-8";
    encode(input = ""): Uint8Array {
      return encodeUtf8(String(input));
    }
  }
  g.TextEncoder = GhostWireTextEncoder;
}

if (typeof g.TextDecoder === "undefined") {
  class GhostWireTextDecoder {
    readonly encoding: string;
    readonly fatal = false;
    readonly ignoreBOM = false;
    constructor(label = "utf-8") {
      this.encoding = label;
    }
    decode(input?: Uint8Array | ArrayBuffer): string {
      if (!input) return "";
      const bytes =
        input instanceof Uint8Array
          ? input
          : new Uint8Array(input as ArrayBufferLike);
      return decodeUtf8(bytes);
    }
  }
  g.TextDecoder = GhostWireTextDecoder;
}
