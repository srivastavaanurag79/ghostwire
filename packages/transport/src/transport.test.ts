import { describe, expect, it } from "vitest";
import { MemoryTransport } from "./memory";

describe("MemoryTransport", () => {
  it("delivers and broadcasts", () => {
    const [a, b] = MemoryTransport.pair("a", "b");
    const received: Array<{ from: string; data: number[] }> = [];
    b.onMessage((from, data) => received.push({ from, data: [...data] }));

    a.send("b", new Uint8Array([1, 2, 3]));
    a.broadcast(new Uint8Array([9]));
    expect(received).toEqual([
      { from: "a", data: [1, 2, 3] },
      { from: "a", data: [9] },
    ]);
  });

  it("emits join and leave", () => {
    const [a, b] = MemoryTransport.pair("a", "b");
    const events: string[] = [];
    a.onPeerJoin((id) => events.push(`join:${id}`));
    a.onPeerLeave((id) => events.push(`leave:${id}`));
    void a.connect("b");
    a.close("b");
    expect(events).toEqual(["join:b", "leave:b"]);
  });

  it("broadcast can exclude the sender", () => {
    const a = new MemoryTransport("a");
    const b = new MemoryTransport("b");
    const c = new MemoryTransport("c");
    a.linkWith(b);
    a.linkWith(c);
    const got: string[] = [];
    b.onMessage(() => got.push("b"));
    c.onMessage(() => got.push("c"));
    a.broadcast(new Uint8Array([1]), "b");
    expect(got).toEqual(["c"]);
    expect(a.peerIds.sort()).toEqual(["b", "c"]);
  });
});
