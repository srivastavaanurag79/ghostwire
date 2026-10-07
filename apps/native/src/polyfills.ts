/**
 * Hermes polyfills.
 *
 * Hermes (React Native) does not provide `TextEncoder` / `TextDecoder` or
 * `crypto.getRandomValues`, but dependencies and our own crypto need them —
 * `@msgpack/msgpack` uses `new TextEncoder()` at module load, and
 * `@noble/hashes` calls `crypto.getRandomValues`. Without these polyfills the
 * app crashes on launch or throws inside functions.
 *
 * This must be imported before any such dependency, so it is the first import
 * in `index.js`.
 */
import * as ExpoCrypto from "expo-crypto";

type MutableGlobal = typeof globalThis & {
  TextEncoder?: unknown;
  TextDecoder?: unknown;
  crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
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

// Hermes has no `crypto` global; @noble/hashes needs `crypto.getRandomValues`.
if (typeof g.crypto === "undefined") {
  g.crypto = {};
}
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = (array: Uint8Array): Uint8Array => {
    const bytes = ExpoCrypto.getRandomBytes(array.length);
    array.set(bytes);
    return array;
  };
}

// `Buffer` is used by react-native-tcp-socket and some libs.
if (typeof (g as { Buffer?: unknown }).Buffer === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bufferModule = require("buffer") as { Buffer: unknown };
  (g as { Buffer?: unknown }).Buffer = bufferModule.Buffer;
}

// `atob` / `btoa` are not in Hermes but are used by assorted libraries.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
if (typeof (g as { atob?: unknown }).atob !== "function") {
  (g as { atob?: unknown }).atob = (data: string): string => {
    const clean = data.replace(/[^A-Za-z0-9+/=]/g, "");
    let binary = "";
    for (let i = 0; i < clean.length; i += 4) {
      const c0 = B64.indexOf(clean[i]!);
      const c1 = B64.indexOf(clean[i + 1]!);
      const c2 = clean[i + 2] === "=" ? -1 : B64.indexOf(clean[i + 2]!);
      const c3 = clean[i + 3] === "=" ? -1 : B64.indexOf(clean[i + 3]!);
      binary += String.fromCharCode((c0 << 2) | (c1 >> 4));
      if (c2 >= 0) binary += String.fromCharCode(((c1 & 15) << 4) | (c2 >> 2));
      if (c3 >= 0) binary += String.fromCharCode(((c2 & 3) << 6) | c3);
    }
    return binary;
  };
}
if (typeof (g as { btoa?: unknown }).btoa !== "function") {
  (g as { btoa?: unknown }).btoa = (data: string): string => {
    let out = "";
    for (let i = 0; i < data.length; i += 3) {
      const c0 = data.charCodeAt(i);
      const c1 = i + 1 < data.length ? data.charCodeAt(i + 1) : NaN;
      const c2 = i + 2 < data.length ? data.charCodeAt(i + 2) : NaN;
      out += B64[c0 >> 2];
      out += B64[((c0 & 3) << 4) | (Number.isNaN(c1) ? 0 : c1 >> 4)];
      out += Number.isNaN(c1) ? "=" : B64[((c1 & 15) << 2) | (Number.isNaN(c2) ? 0 : c2 >> 6)];
      out += Number.isNaN(c2) ? "=" : B64[c2 & 63];
    }
    return out;
  };
}
