import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, type KeyPair } from "@ghostwire/crypto";
import { issueRoleToken } from "@ghostwire/roles";
import { MemoryTransport } from "@ghostwire/transport";
import { timingSafeEqual } from "@ghostwire/crypto";
import type { InnerMessage, Role, RoleToken } from "@ghostwire/protocol";
import { MeshNode, type MeshIdentity } from "./index";

const sessionId = "flow-session";

function identity(
  name: string,
  role: Role,
  subject: KeyPair,
  issuer: KeyPair,
): MeshIdentity {
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

/** Mirrors the app's join_request -> join_accept -> chat flow end to end. */
describe("session join flow", () => {
  const adminKeys = generateSigningKeyPair();
  const guestKeys = generateSigningKeyPair();
  const sessionKey = new Uint8Array(32).fill(9);
  const sessionStart = Date.now() - 1000;

  it("lets a guest request, get approved, and then chat", () => {
    const [hostTransport, guestTransport] = MemoryTransport.pair("host", "guest");
    const hostInbox: InnerMessage[] = [];
    const guestInbox: InnerMessage[] = [];

    let host: MeshNode;
    let guest: MeshNode;

    host = new MeshNode({
      transport: hostTransport,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey: adminKeys.publicKey,
      identity: identity("Admin", "admin", adminKeys, adminKeys),
      onMessage: (inner) => {
        hostInbox.push(inner);
        if (inner.type === "join_request") {
          // Admin issues a speaker token bound to the guest's key.
          const token = issueRoleToken({
            sessionId,
            name: inner.sender.name,
            subjectPubkey: inner.sender.pubkey,
            role: "speaker",
            issuerPrivateKey: adminKeys.privateKey,
            issuerPubkey: adminKeys.publicKey,
          });
          host.send("join_accept", { token });
        }
      },
    });

    guest = new MeshNode({
      transport: guestTransport,
      sessionId,
      sessionKey,
      sessionStart,
      adminPubKey: adminKeys.publicKey,
      identity: identity("Guest", "listener", guestKeys, guestKeys),
      onMessage: (inner) => {
        guestInbox.push(inner);
        if (inner.type === "join_accept") {
          const token = (inner.body as { token: RoleToken }).token;
          if (timingSafeEqual(token.pubkey, guestKeys.publicKey)) {
            guest.updateIdentity({ role: token.role, token });
          }
        }
      },
    });

    host.start();
    guest.start();

    // Before approval, a listener cannot chat.
    expect(() => guest.send("chat", { text: "too early" })).toThrow();

    // Guest asks to join; host auto-approves with a speaker token.
    guest.send("join_request", { name: "Guest", pubkey: guestKeys.publicKey });
    expect(guest.identity.role).toBe("speaker");

    // Now the guest can chat and the host receives it.
    guest.send("chat", { text: "hello from the guest" });
    const chat = hostInbox.find((m) => m.type === "chat");
    expect(chat).toBeDefined();
    expect(chat!.sender.name).toBe("Guest");
    expect(chat!.sender.role).toBe("speaker");
    expect((chat!.body as { text: string }).text).toBe("hello from the guest");
    expect(guestInbox.some((m) => m.type === "join_accept")).toBe(true);
  });
});
