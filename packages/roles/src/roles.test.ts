import { describe, expect, it } from "vitest";
import { generateSigningKeyPair } from "@ghostwire/crypto";
import type { Role } from "@ghostwire/protocol";
import {
  canIssueRole,
  canSend,
  issueDelegationCert,
  issueRoleToken,
  verifyDelegationCert,
  verifyRoleToken,
  type TrustContext,
} from "./index";

const sessionId = "session-1";

function keys() {
  const admin = generateSigningKeyPair();
  const moderator = generateSigningKeyPair();
  const user = generateSigningKeyPair();
  const ctx: TrustContext = { sessionId, adminPubKey: admin.publicKey };
  return { admin, moderator, user, ctx };
}

function tokenFor(
  ctx: TrustContext,
  issuer: { publicKey: Uint8Array; privateKey: Uint8Array },
  subjectPubkey: Uint8Array,
  role: Role,
) {
  return issueRoleToken({
    sessionId,
    name: "user",
    subjectPubkey,
    role,
    issuerPrivateKey: issuer.privateKey,
    issuerPubkey: issuer.publicKey,
  });
}

describe("role tokens", () => {
  it("admin can issue any role", () => {
    const { admin, user, ctx } = keys();
    const token = tokenFor(ctx, admin, user.publicKey, "speaker");
    expect(verifyRoleToken(token, ctx).ok).toBe(true);
  });

  it("rejects a forged admin signature", () => {
    const { admin, moderator, user, ctx } = keys();
    const token = tokenFor(ctx, admin, user.publicKey, "speaker");
    // Re-sign the canonical bytes with the wrong key.
    const forged = { ...token, signature: new Uint8Array(64) };
    expect(verifyRoleToken(forged, ctx).ok).toBe(false);
    expect(moderator).toBeDefined();
  });

  it("rejects an expired token", () => {
    const { admin, user } = keys();
    const token = issueRoleToken({
      sessionId,
      name: "user",
      subjectPubkey: user.publicKey,
      role: "speaker",
      issuerPrivateKey: admin.privateKey,
      issuerPubkey: admin.publicKey,
      ttlSeconds: -10,
    });
    const ctx: TrustContext = { sessionId, adminPubKey: admin.publicKey };
    expect(verifyRoleToken(token, ctx).ok).toBe(false);
  });
});

describe("delegation", () => {
  it("moderator can issue speaker tokens when delegated", () => {
    const { admin, moderator, user } = keys();
    const cert = issueDelegationCert({
      sessionId,
      subjectPubkey: moderator.publicKey,
      issuerPrivateKey: admin.privateKey,
      issuerPubkey: admin.publicKey,
      permissions: ["approve"],
    });
    const ctx: TrustContext = {
      sessionId,
      adminPubKey: admin.publicKey,
      delegations: [cert],
    };
    expect(verifyDelegationCert(cert, ctx).ok).toBe(true);
    const token = tokenFor(ctx, moderator, user.publicKey, "speaker");
    expect(verifyRoleToken(token, ctx).ok).toBe(true);
  });

  it("moderator cannot issue privileged roles", () => {
    const { admin, moderator, user } = keys();
    const cert = issueDelegationCert({
      sessionId,
      subjectPubkey: moderator.publicKey,
      issuerPrivateKey: admin.privateKey,
      issuerPubkey: admin.publicKey,
    });
    const ctx: TrustContext = { sessionId, adminPubKey: admin.publicKey, delegations: [cert] };
    const token = tokenFor(ctx, moderator, user.publicKey, "moderator");
    const result = verifyRoleToken(token, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown issuer", () => {
    const { admin, moderator, user } = keys();
    const ctx: TrustContext = { sessionId, adminPubKey: admin.publicKey };
    const token = tokenFor(ctx, moderator, user.publicKey, "speaker");
    expect(verifyRoleToken(token, ctx).ok).toBe(false);
  });
});

describe("permissions", () => {
  it("only speakers and above can send", () => {
    expect(canSend("listener")).toBe(false);
    expect(canSend("speaker")).toBe(true);
    expect(canSend("moderator")).toBe(true);
    expect(canSend("admin")).toBe(true);
  });

  it("moderators can only grant speaker/listener", () => {
    expect(canIssueRole("moderator", "speaker")).toBe(true);
    expect(canIssueRole("moderator", "listener")).toBe(true);
    expect(canIssueRole("moderator", "moderator")).toBe(false);
    expect(canIssueRole("admin", "moderator")).toBe(true);
  });
});
