import { sign, timingSafeEqual, verify } from "@ghostwire/crypto";
import { pack, type DelegationCert, type RoleToken, type Role } from "@ghostwire/protocol";
import { DEFAULT_TOKEN_TTL_SECONDS } from "@ghostwire/protocol";

/**
 * Canonical bytes signed by the issuer of a role token. Only the issuer
 * identity and role are bound here; nothing about the session secret.
 */
export function roleTokenSigningBytes(token: Omit<RoleToken, "signature"> | RoleToken): Uint8Array {
  return pack([
    token.v,
    token.sid,
    token.name,
    token.pubkey,
    token.role,
    token.expiry,
    token.issuer,
  ]);
}

/** Canonical bytes signed by the admin for a moderator delegation. */
export function delegationSigningBytes(
  cert: Omit<DelegationCert, "signature"> | DelegationCert,
): Uint8Array {
  return pack([
    cert.v,
    cert.sid,
    cert.subjectPubkey,
    cert.issuerPubkey,
    cert.permissions,
    cert.expiry,
  ]);
}

export interface IssueTokenParams {
  sessionId: string;
  name: string;
  subjectPubkey: Uint8Array;
  role: Role;
  issuerPrivateKey: Uint8Array;
  issuerPubkey: Uint8Array;
  ttlSeconds?: number;
  now?: number;
}

/** Sign and return a fresh role token. */
export function issueRoleToken(params: IssueTokenParams): RoleToken {
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const unsigned: Omit<RoleToken, "signature"> = {
    v: 1,
    sid: params.sessionId,
    name: params.name,
    pubkey: params.subjectPubkey,
    role: params.role,
    expiry: now + (params.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS),
    issuer: params.issuerPubkey,
  };
  const signature = sign(roleTokenSigningBytes(unsigned), params.issuerPrivateKey);
  return { ...unsigned, signature };
}

export interface IssueDelegationParams {
  sessionId: string;
  subjectPubkey: Uint8Array;
  issuerPrivateKey: Uint8Array;
  issuerPubkey: Uint8Array;
  permissions?: DelegationCert["permissions"];
  ttlSeconds?: number;
  now?: number;
}

/** Admin signs a delegation certificate for a moderator. */
export function issueDelegationCert(params: IssueDelegationParams): DelegationCert {
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const unsigned: Omit<DelegationCert, "signature"> = {
    v: 1,
    sid: params.sessionId,
    subjectPubkey: params.subjectPubkey,
    issuerPubkey: params.issuerPubkey,
    permissions: params.permissions ?? ["approve", "revoke"],
    expiry: now + (params.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS),
  };
  const signature = sign(delegationSigningBytes(unsigned), params.issuerPrivateKey);
  return { ...unsigned, signature };
}

export interface TrustContext {
  sessionId: string;
  adminPubKey: Uint8Array;
  /** Delegation certs received from the admin (for moderators). */
  delegations?: DelegationCert[];
  now?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const OK: VerifyResult = { ok: true };

function fail(reason: string): VerifyResult {
  return { ok: false, reason };
}

/** Verify that a delegation certificate was signed by the admin. */
export function verifyDelegationCert(
  cert: DelegationCert,
  ctx: TrustContext,
): VerifyResult {
  if (cert.v !== 1) return fail("bad delegation version");
  if (cert.sid !== ctx.sessionId) return fail("delegation session mismatch");
  const now = ctx.now ?? Math.floor(Date.now() / 1000);
  if (cert.expiry <= now) return fail("delegation expired");
  if (!timingSafeEqual(cert.issuerPubkey, ctx.adminPubKey)) {
    return fail("delegation not issued by admin");
  }
  const valid = verify(cert.signature, delegationSigningBytes(cert), ctx.adminPubKey);
  return valid ? OK : fail("bad delegation signature");
}

/**
 * Full client-side verification of a role token:
 *  - binds to this session and is unexpired;
 *  - signature valid under the claimed issuer;
 *  - issuer is either the admin or a delegated moderator.
 */
export function verifyRoleToken(token: RoleToken, ctx: TrustContext): VerifyResult {
  if (token.v !== 1) return fail("bad token version");
  if (token.sid !== ctx.sessionId) return fail("token session mismatch");
  const now = ctx.now ?? Math.floor(Date.now() / 1000);
  if (token.expiry <= now) return fail("token expired");

  const issuerIsAdmin = timingSafeEqual(token.issuer, ctx.adminPubKey);
  if (issuerIsAdmin) {
    const valid = verify(token.signature, roleTokenSigningBytes(token), token.issuer);
    return valid ? OK : fail("bad admin token signature");
  }

  const delegation = ctx.delegations?.find((c) =>
    timingSafeEqual(c.subjectPubkey, token.issuer),
  );
  if (!delegation) return fail("issuer is not admin or a known moderator");
  if (token.role === "admin" || token.role === "moderator") {
    return fail("moderator cannot issue privileged roles");
  }
  if (!delegation.permissions.includes("approve")) {
    return fail("moderator lacks approve permission");
  }
  const certResult = verifyDelegationCert(delegation, ctx);
  if (!certResult.ok) return certResult;
  const valid = verify(token.signature, roleTokenSigningBytes(token), token.issuer);
  return valid ? OK : fail("bad moderator token signature");
}

/** True when a role is allowed to publish chat messages and files. */
export function canSend(role: Role): boolean {
  return role === "admin" || role === "moderator" || role === "speaker";
}

/** True when an issuer with `issuerRole` may grant `subjectRole`. */
export function canIssueRole(issuerRole: Role, subjectRole: Role): boolean {
  if (issuerRole === "admin") return true;
  if (issuerRole === "moderator") return subjectRole === "speaker" || subjectRole === "listener";
  return false;
}

/** Only the admin may close a session or broadcast revocations. */
export function canCloseSession(role: Role): boolean {
  return role === "admin";
}

export function canRevoke(role: Role): boolean {
  return role === "admin" || role === "moderator";
}
