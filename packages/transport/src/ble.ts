import { BaseTransport, type SignalingData } from "./types";

/**
 * Bluetooth Low Energy transport core (platform-agnostic).
 *
 * The radio is provided by an injected `BleAdapter` (central/peripheral), so the
 * framing, reassembly, peer bookkeeping and mesh wiring can be unit-tested with a
 * fake adapter — no hardware required. React Native supplies the real adapter in
 * `apps/native`.
 *
 * BLE needs no signalling handshake, so a session bootstraps with a single QR.
 */

export const GHOSTWIRE_SERVICE_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000001";
export const GHOSTWIRE_WRITE_CHAR_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000002";
export const GHOSTWIRE_NOTIFY_CHAR_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000003";

/** Conservative payload bytes per BLE write across devices. */
export const BLE_CHUNK_BYTES = 180;

/** Split a frame into `[total:1][index:1][payload]` chunks. */
export function chunk(data: Uint8Array, chunkBytes = BLE_CHUNK_BYTES): Uint8Array[] {
  const total = Math.max(1, Math.ceil(data.length / chunkBytes));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const slice = data.subarray(i * chunkBytes, (i + 1) * chunkBytes);
    const out = new Uint8Array(2 + slice.length);
    out[0] = total;
    out[1] = i;
    out.set(slice, 2);
    chunks.push(out);
  }
  return chunks;
}

/** Reassembles chunked frames per peer. */
export class Reassembler {
  private readonly parts = new Map<string, { total: number; got: Map<number, Uint8Array> }>();

  /** Feed a raw BLE write; returns the full frame once all chunks arrived. */
  push(peerId: string, bytes: Uint8Array): Uint8Array | null {
    if (bytes.length < 2) return null;
    const total = bytes[0]!;
    const index = bytes[1]!;
    const payload = bytes.subarray(2);
    let entry = this.parts.get(peerId);
    if (!entry || entry.total !== total) {
      entry = { total, got: new Map() };
      this.parts.set(peerId, entry);
    }
    entry.got.set(index, payload);
    if (entry.got.size < total) return null;
    let length = 0;
    for (const part of entry.got.values()) length += part.length;
    const frame = new Uint8Array(length);
    let offset = 0;
    for (let i = 0; i < total; i++) {
      const part = entry.got.get(i);
      if (!part) return null;
      frame.set(part, offset);
      offset += part.length;
    }
    this.parts.delete(peerId);
    return frame;
  }

  forget(peerId: string): void {
    this.parts.delete(peerId);
  }
}

export interface BlePeerHandle {
  id: string;
  write(frame: Uint8Array): Promise<void>;
}

export interface BleAdapter {
  start(opts: {
    serviceUuid: string;
    writeCharUuid: string;
    notifyCharUuid: string;
    onPeer: (peer: BlePeerHandle) => void;
    onPeerLost: (peerId: string) => void;
    onData: (peerId: string, data: Uint8Array) => void;
  }): Promise<void>;
  stop(): Promise<void>;
}

export class BleTransport extends BaseTransport {
  private readonly peers = new Map<string, BlePeerHandle>();
  private readonly reassembler = new Reassembler();
  private started = false;

  constructor(private readonly adapter: BleAdapter) {
    super();
  }

  get peerIds(): readonly string[] {
    return [...this.peers.keys()];
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.adapter.start({
      serviceUuid: GHOSTWIRE_SERVICE_UUID,
      writeCharUuid: GHOSTWIRE_WRITE_CHAR_UUID,
      notifyCharUuid: GHOSTWIRE_NOTIFY_CHAR_UUID,
      onPeer: (peer) => {
        this.peers.set(peer.id, peer);
        this.emitJoin(peer.id);
      },
      onPeerLost: (peerId) => {
        this.peers.delete(peerId);
        this.reassembler.forget(peerId);
        this.emitLeave(peerId);
      },
      onData: (peerId, data) => {
        const frame = this.reassembler.push(peerId, data);
        if (frame) this.emitMessage(peerId, frame);
      },
    });
  }

  connect(_peerId: string, _signaling?: SignalingData): Promise<void> {
    // BLE peers are discovered and connected by the adapter; no signaling blob.
    return Promise.resolve();
  }

  send(peerId: string, data: Uint8Array): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    void (async () => {
      for (const part of chunk(data)) await peer.write(part);
    })();
  }

  broadcast(data: Uint8Array, exceptPeerId?: string): void {
    for (const id of this.peers.keys()) {
      if (id === exceptPeerId) continue;
      this.send(id, data);
    }
  }

  close(peerId?: string): void {
    if (peerId) {
      this.peers.delete(peerId);
      this.emitLeave(peerId);
      return;
    }
    for (const id of [...this.peers.keys()]) {
      this.peers.delete(id);
      this.emitLeave(id);
    }
    void this.adapter.stop();
    this.started = false;
  }
}
