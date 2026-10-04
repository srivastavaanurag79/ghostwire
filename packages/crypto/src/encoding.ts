import { base64, base64urlnopad, hex } from "@scure/base";

/** UTF-8 encode a string to bytes. */
export function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Decode UTF-8 bytes to a string. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
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
