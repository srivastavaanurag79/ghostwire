import { describe, expect, it } from "vitest";
import { generateSigningKeyPair } from "@ghostwire/crypto";
import { issueRoleToken, verifyRoleToken, type TrustContext } from "./index";

const sessionId = "multi-admin";

describe("multi-admin", () => {
  it("accepts tokens issued by a granted additional admin", () => {
    const primary = generateSigningKeyPair();
    const coAdmin = generateSigningKeyPair();
    const user = generateSigningKeyPair();

    const ctx: TrustContext = {
      sessionId,
      adminPubKey: primary.publicKey,
      adminPubKeys: [coAdmin.publicKey],
    };

    const token = issueRoleToken({
      sessionId,
      name: "user",
      subjectPubkey: user.publicKey,
      role: "speaker",
      issuerPrivateKey: coAdmin.privateKey,
      issuerPubkey: coAdmin.publicKey,
    });

    expect(verifyRoleToken(token, ctx).ok).toBe(true);
  });

  it("still rejects issuers outside the admin set", () => {
    const primary = generateSigningKeyPair();
    const stranger = generateSigningKeyPair();
    const user = generateSigningKeyPair();
    const ctx: TrustContext = { sessionId, adminPubKey: primary.publicKey };

    const token = issueRoleToken({
      sessionId,
      name: "user",
      subjectPubkey: user.publicKey,
      role: "speaker",
      issuerPrivateKey: stranger.privateKey,
      issuerPubkey: stranger.publicKey,
    });

    expect(verifyRoleToken(token, ctx).ok).toBe(false);
  });
});
