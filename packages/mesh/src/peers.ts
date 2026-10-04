import type { Peer, Role } from "@ghostwire/protocol";

/** Tracks who is connected, keyed by transport peer id. */
export class PeerRegistry {
  private readonly peers = new Map<string, Peer>();

  upsert(
    id: string,
    data: { name: string; pubkey: Uint8Array; role: Role },
    now = Date.now(),
  ): Peer {
    const existing = this.peers.get(id);
    if (existing) {
      existing.name = data.name;
      existing.pubkey = data.pubkey;
      existing.role = data.role;
      existing.lastSeen = now;
      return existing;
    }
    const peer: Peer = {
      id,
      name: data.name,
      pubkey: data.pubkey,
      role: data.role,
      connectedAt: now,
      lastSeen: now,
    };
    this.peers.set(id, peer);
    return peer;
  }

  touch(id: string, now = Date.now()): void {
    const peer = this.peers.get(id);
    if (peer) peer.lastSeen = now;
  }

  get(id: string): Peer | undefined {
    return this.peers.get(id);
  }

  remove(id: string): void {
    this.peers.delete(id);
  }

  list(): Peer[] {
    return [...this.peers.values()];
  }

  prune(timeoutMs: number, now = Date.now()): string[] {
    const gone: string[] = [];
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > timeoutMs) {
        this.peers.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  clear(): void {
    this.peers.clear();
  }
}
