import { BaseTransport, type SignalingData } from "./types";

/**
 * In-process transport used by tests and by same-tab simulations. Links are
 * bidirectional and synchronous.
 */
export class MemoryTransport extends BaseTransport {
  private readonly links = new Map<string, MemoryTransport>();

  get peerIds(): readonly string[] {
    return [...this.links.keys()];
  }

  get id(): string {
    return this.selfId;
  }

  /** Link this transport to another (used by tests to build arbitrary graphs). */
  linkWith(other: MemoryTransport): void {
    this.links.set(other.selfId, other);
    other.links.set(this.selfId, this);
  }

  connect(peerId: string, _signaling?: SignalingData): Promise<void> {
    const other = this.links.get(peerId);
    if (!other) throw new Error(`MemoryTransport: unknown peer ${peerId}`);
    this.emitJoin(peerId);
    return Promise.resolve();
  }

  send(peerId: string, data: Uint8Array): void {
    const other = this.links.get(peerId);
    if (!other) return;
    other.emitMessage(this.selfId, data);
  }

  broadcast(data: Uint8Array, exceptPeerId?: string): void {
    for (const [id, other] of this.links) {
      if (id === exceptPeerId) continue;
      other.emitMessage(this.selfId, data);
    }
  }

  close(peerId?: string): void {
    if (peerId) {
      if (this.links.delete(peerId)) this.emitLeave(peerId);
      return;
    }
    for (const id of [...this.links.keys()]) {
      this.links.delete(id);
      this.emitLeave(id);
    }
  }

  constructor(private readonly selfId: string = "self") {
    super();
  }

  /** Create a bidirectionally linked pair of transports. */
  static pair(idA = "a", idB = "b"): [MemoryTransport, MemoryTransport] {
    const a = new MemoryTransport(idA);
    const b = new MemoryTransport(idB);
    a.links.set(idB, b);
    b.links.set(idA, a);
    return [a, b];
  }
}
