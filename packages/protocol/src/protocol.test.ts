import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, randomBytes } from "@ghostwire/crypto";
import {
  DEFAULT_TTL,
  SessionKeyring,
  decodeEnvelope,
  encodeEnvelope,
  forwardEnvelope,
  isForwardable,
  openEnvelope,
  sealEnvelope,
  type SenderInfo,
} from "./index";

function adminSender(): { sender: SenderInfo; privateKey: Uint8Array } {
  const keyPair = generateSigningKeyPair();
  return {
    privateKey: keyPair.privateKey,
    sender: {
      name: "Admin",
      pubkey: keyPair.publicKey,
      role: "admin",
      token: {
        v: 1,
        sid: "s1",
        name: "Admin",
        pubkey: keyPair.publicKey,
        role: "admin",
        expiry: Math.floor(Date.now() / 1000) + 3600,
        issuer: keyPair.publicKey,
        signature: new Uint8Array(64),
      },
    },
  };
}

describe("SessionKeyring", () => {
  it("is deterministic across peers", () => {
    const root = randomBytes(32);
    const start = 1_000_000;
    const a = new SessionKeyring(root, start);
    const b = new SessionKeyring(root, start);
    const epoch = a.advanceTo(start + 3 * 60_000);
    expect(epoch).toBe(3);
    expect(b.keyAt(epoch)!).toEqual(a.keyAt(epoch)!);
  });

  it("cannot derive past epochs after pruning", () => {
    const ring = new SessionKeyring(randomBytes(32), 0, 60_000, 2);
    ring.advanceTo(10 * 60_000);
    expect(ring.keyAt(0)).toBeUndefined();
    expect(ring.keyAt(7)).toBeUndefined();
    expect(ring.keyAt(9)).toBeDefined();
  });
});

describe("envelope", () => {
  it("round-trips through seal/open", () => {
    const root = randomBytes(32);
    const start = Date.now() - 60_000;
    const a = new SessionKeyring(root, start);
    const b = new SessionKeyring(root, start);
    const { sender, privateKey } = adminSender();
    const envelope = sealEnvelope({
      keyring: a,
      sender,
      signerPrivateKey: privateKey,
      type: "chat",
      body: { text: "hi" },
    });
    const opened = openEnvelope(envelope, b);
    expect(opened.signatureValid).toBe(true);
    expect(opened.inner.body).toMatchObject({ text: "hi" });
    expect(opened.inner.type).toBe("chat");
  });

  it("rejects a tampered ciphertext", () => {
    const root = randomBytes(32);
    const start = Date.now() - 60_000;
    const a = new SessionKeyring(root, start);
    const b = new SessionKeyring(root, start);
    const { sender, privateKey } = adminSender();
    const envelope = sealEnvelope({ keyring: a, sender, signerPrivateKey: privateKey, type: "chat", body: { text: "hi" } });
    envelope.ciphertext[0] = envelope.ciphertext[0]! ^ 0xff;
    expect(() => openEnvelope(envelope, b)).toThrow();
  });

  it("survives wire encode/decode and hop rewriting", () => {
    const root = randomBytes(32);
    const start = Date.now() - 60_000;
    const a = new SessionKeyring(root, start);
    const { sender, privateKey } = adminSender();
    const envelope = sealEnvelope({ keyring: a, sender, signerPrivateKey: privateKey, type: "ping", body: { nonce: "n" } });
    const forwarded = forwardEnvelope(envelope);
    expect(forwarded.ttl).toBe(envelope.ttl - 1);
    expect(forwarded.hops).toBe(1);
    expect(isForwardable(envelope, 10)).toBe(true);
    const decoded = decodeEnvelope(encodeEnvelope(forwarded));
    expect(decoded.id).toBe(envelope.id);
    expect(envelope.ttl).toBe(DEFAULT_TTL);
  });
});
