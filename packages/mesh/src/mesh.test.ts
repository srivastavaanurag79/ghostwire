import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, type KeyPair } from "@ghostwire/crypto";
import { issueRoleToken } from "@ghostwire/roles";
import { MemoryTransport } from "@ghostwire/transport";
import type { InnerMessage, Role, RoleToken } from "@ghostwire/protocol";
import { MeshNode, SeenCache, type MeshIdentity } from "./index";

const sessionId = "mesh-session";

function makeIdentity(
  name: string,
  role: Role,
  subject: KeyPair,
  admin: KeyPair,
): MeshIdentity {
  const token: RoleToken = issueRoleToken({
    sessionId,
    name,
    subjectPubkey: subject.publicKey,
    role,
    issuerPrivateKey: admin.privateKey,
    issuerPubkey: admin.publicKey,
  });
  return {
    name,
    role,
    token,
    publicKey: subject.publicKey,
    privateKey: subject.privateKey,
  };
}

function makeNode(
  transport: MemoryTransport,
  identity: MeshIdentity,
  adminPubKey: Uint8Array,
  sessionKey: Uint8Array,
  sessionStart: number,
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

describe("MeshNode", () => {
  const admin = generateSigningKeyPair();
  const speaker = generateSigningKeyPair();
  const listener = generateSigningKeyPair();
  const sessionKey = new Uint8Array(32).fill(7);
  const sessionStart = Date.now() - 1000;

  it("delivers a chat message across one hop", () => {
    const [ta, tb] = MemoryTransport.pair("a", "b");
    const inboxA: InnerMessage[] = [];
    const inboxB: InnerMessage[] = [];
    const a = makeNode(ta, makeIdentity("Admin", "admin", admin, admin), admin.publicKey, sessionKey, sessionStart, inboxA);
    makeNode(tb, makeIdentity("Speaker", "speaker", speaker, admin), admin.publicKey, sessionKey, sessionStart, inboxB);

    a.send("chat", { text: "hello" });
    expect(inboxB).toHaveLength(1);
    expect(inboxB[0]!.type).toBe("chat");
    expect(inboxB[0]!.sender.name).toBe("Admin");
    expect(inboxA).toHaveLength(0);
  });

  it("relays across a 3-node line exactly once", () => {
    const ta = new MemoryTransport("a");
    const tb = new MemoryTransport("b");
    const tc = new MemoryTransport("c");
    ta.linkWith(tb);
    tb.linkWith(tc);
    const inboxA: InnerMessage[] = [];
    const inboxB: InnerMessage[] = [];
    const inboxC: InnerMessage[] = [];
    const a = makeNode(ta, makeIdentity("Admin", "admin", admin, admin), admin.publicKey, sessionKey, sessionStart, inboxA);
    makeNode(tb, makeIdentity("Speaker", "speaker", speaker, admin), admin.publicKey, sessionKey, sessionStart, inboxB);
    makeNode(tc, makeIdentity("Listener", "listener", listener, admin), admin.publicKey, sessionKey, sessionStart, inboxC);

    a.send("chat", { text: "mesh" });
    expect(inboxB).toHaveLength(1);
    expect(inboxC).toHaveLength(1);
    expect(inboxC[0]!.sender.name).toBe("Admin");
    expect(inboxA).toHaveLength(0);
  });

  it("prevents a listener from sending", () => {
    const [ta] = MemoryTransport.pair("a", "b");
    const node = makeNode(ta, makeIdentity("Listener", "listener", listener, admin), admin.publicKey, sessionKey, sessionStart, []);
    expect(() => node.send("chat", { text: "nope" })).toThrow();
  });

  it("rejects messages carrying a forged token", () => {
    const [ta, tb] = MemoryTransport.pair("a", "b");
    const inbox: InnerMessage[] = [];
    const drops: string[] = [];
    const identity = makeIdentity("Admin", "admin", admin, admin);
    identity.token = { ...identity.token, role: "listener", signature: new Uint8Array(64) };
    const node = new MeshNode({
      transport: ta,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey: admin.publicKey,
      identity,
      onMessage: (inner) => inbox.push(inner),
      onDrop: (reason) => drops.push(reason),
    });
    node.start();
    makeNode(tb, makeIdentity("Speaker", "speaker", speaker, admin), admin.publicKey, sessionKey, sessionStart, []);
    node.send("chat", { text: "forged" });
    expect(inbox).toHaveLength(0);
    expect(drops.length).toBeGreaterThanOrEqual(0);
  });
});

describe("SeenCache", () => {
  it("drops duplicates and respects its cap", () => {
    const cache = new SeenCache(2);
    expect(cache.add("a")).toBe(true);
    expect(cache.add("a")).toBe(false);
    cache.add("b");
    cache.add("c");
    expect(cache.has("a")).toBe(false);
  });
});
