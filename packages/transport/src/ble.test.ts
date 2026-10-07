import { describe, expect, it } from "vitest";
import { BLE_CHUNK_BYTES, BleTransport, Reassembler, chunk, type BleAdapter, type BlePeerHandle } from "./ble";

/** A fake BLE adapter: no radio, just a link between two instances. */
class FakeAdapter implements BleAdapter {
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    this.opts = opts;
  }

  async stop(): Promise<void> {
    this.opts = null;
  }

  /** Cross-wire two adapters so writes flow to the other's onData. */
  connect(other: FakeAdapter): void {
    const aToB: BlePeerHandle = { id: "b", write: async (frame) => other.opts?.onData("a", frame) };
    const bToA: BlePeerHandle = { id: "a", write: async (frame) => this.opts?.onData("b", frame) };
    this.opts?.onPeer(aToB);
    other.opts?.onPeer(bToA);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("BLE framing", () => {
  it("chunks and reassembles a frame larger than the MTU", () => {
    const data = new Uint8Array(BLE_CHUNK_BYTES * 2 + 17).fill(0xab);
    const parts = chunk(data);
    expect(parts.length).toBe(3);
    const re = new Reassembler();
    expect(re.push("p", parts[0]!)).toBeNull();
    expect(re.push("p", parts[1]!)).toBeNull();
    const full = re.push("p", parts[2]!);
    expect(full).not.toBeNull();
    expect(full!.length).toBe(data.length);
    expect([...full!]).toEqual([...data]);
  });
});

describe("BleTransport (fake adapter, no radio)", () => {
  it("connects, broadcasts, and reassembles across peers", async () => {
    const adapterA = new FakeAdapter();
    const adapterB = new FakeAdapter();
    const a = new BleTransport(adapterA);
    const b = new BleTransport(adapterB);
    await a.start();
    await b.start();

    const joined: string[] = [];
    a.onPeerJoin((id) => joined.push(id));
    adapterA.connect(adapterB);
    expect(joined).toEqual(["b"]);
    expect(a.peerIds).toContain("b");

    const received = new Promise<number[]>((resolve) => {
      b.onMessage((_from, data) => resolve([...data]));
    });
    const payload = new Uint8Array(BLE_CHUNK_BYTES * 3 + 5).map((_, i) => i % 256);
    a.broadcast(payload);
    await tick();
    expect(await received).toEqual([...payload]);
  });

  it("excludes the sender when broadcasting", async () => {
    const adapterA = new FakeAdapter();
    const adapterB = new FakeAdapter();
    const a = new BleTransport(adapterA);
    const b = new BleTransport(adapterB);
    await a.start();
    await b.start();
    adapterA.connect(adapterB);

    let count = 0;
    a.onMessage(() => count++);
    b.onMessage(() => count++);
    a.broadcast(new Uint8Array([1, 2, 3]), "b");
    await tick();
    expect(count).toBe(0);
  });
});
