import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, type KeyPair } from "@ghostwire/crypto";
import { issueRoleToken } from "@ghostwire/roles";
import { MemoryTransport } from "@ghostwire/transport";
import type { InnerMessage, Role, RoleToken } from "@ghostwire/protocol";
import { MeshNode, type MeshIdentity } from "./index";

const sessionId = "mesh-admin";
const sessionKey = new Uint8Array(32).fill(5);
const sessionStart = Date.now() - 1000;

function makeIdentity(name: string, role: Role, subject: KeyPair, issuer: KeyPair): MeshIdentity {
  const token: RoleToken = issueRoleToken({
    sessionId,
    name,
    subjectPubkey: subject.publicKey,
    role,
    issuerPrivateKey: issuer.privateKey,
    issuerPubkey: issuer.publicKey,
  });
  return { name, role, token, publicKey: subject.publicKey, privateKey: subject.privateKey };
}

function makeNode(
  transport: MemoryTransport,
  identity: MeshIdentity,
  adminPubKey: Uint8Array,
  inbox: InnerMessage[],
): MeshNode {
  const node = new MeshNode({
    transport,
    sessionId,
    sessionKey,
    sessionStart,
    adminPubKey,
    identity,
    onMessage: (inner) => inbox.push(inner),
  });
  node.start();
  return node;
}

describe("mesh multi-admin & capabilities", () => {
  it("propagates an admin grant so peers trust the new admin", () => {
    const admin = generateSigningKeyPair();
    const speaker = generateSigningKeyPair();
    const coAdmin = generateSigningKeyPair();
    const [ta, tb] = MemoryTransport.pair("a", "b");
    const a = makeNode(ta, makeIdentity("Admin", "admin", admin, admin), admin.publicKey, []);
    const b = makeNode(tb, makeIdentity("Speaker", "speaker", speaker, admin), admin.publicKey, []);

    a.send("admin_grant", { pubkey: coAdmin.publicKey, name: "Co-admin" });
    expect(b.isAdmin(coAdmin.publicKey)).toBe(true);
    expect(a.isAdmin(coAdmin.publicKey)).toBe(true);
  });

  it("records peer capabilities advertised in peer_announce", () => {
    const admin = generateSigningKeyPair();
    const speaker = generateSigningKeyPair();
    const [ta, tb] = MemoryTransport.pair("a", "b");
    const a = makeNode(ta, makeIdentity("Admin", "admin", admin, admin), admin.publicKey, []);
    const b = makeNode(tb, makeIdentity("Speaker", "speaker", speaker, admin), admin.publicKey, []);

    a.send("peer_announce", { peers: [], pv: 1, caps: ["multi-admin", "msg-jitter"] });
    expect(b.peerInfo(a.identity.publicKey)?.caps).toContain("multi-admin");
    expect(b.peerInfo(a.identity.publicKey)?.pv).toBe(1);
  });

  it("refuses an admin_grant from a non-admin", () => {
    const admin = generateSigningKeyPair();
    const speaker = generateSigningKeyPair();
    const coAdmin = generateSigningKeyPair();
    const [ta, tb] = MemoryTransport.pair("a", "b");
    const a = makeNode(ta, makeIdentity("Speaker", "speaker", speaker, admin), admin.publicKey, []);
    const b = makeNode(tb, makeIdentity("Admin", "admin", admin, admin), admin.publicKey, []);

    // The sender's own client refuses to emit it…
    expect(() => a.send("admin_grant", { pubkey: coAdmin.publicKey })).toThrow();
    // …and the receiver never trusts it.
    expect(b.isAdmin(coAdmin.publicKey)).toBe(false);
  });
});
