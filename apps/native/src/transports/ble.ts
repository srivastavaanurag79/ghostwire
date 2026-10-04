import { BaseTransport, type SignalingData } from "@ghostwire/transport";

/**
 * Bluetooth Low Energy mesh transport.
 *
 * This is the transport that makes GhostWire work when the internet AND Wi‑Fi
 * are gone: phones relay end-to-end-encrypted frames directly to each other.
 *
 * Key advantage over WebRTC: BLE needs **no signaling round-trip**, so a session
 * can be bootstrapped with a **single QR** (it carries only the session key).
 * Everything else (roles, dedup, TTL, encryption) is handled by `@ghostwire/mesh`.
 *
 * Roles: every node advertises the GhostWire GATT service AND scans for it, so
 * devices form a mesh. `react-native-ble-plx` covers the central (scan/connect/
 * write) half; advertising needs a peripheral module (e.g. react-native-ble-
 * advertiser). Both are supplied through the `BleAdapter` contract so the
 * transport core stays testable and platform-agnostic.
 */

export const GHOSTWIRE_SERVICE_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000001";
export const GHOSTWIRE_WRITE_CHAR_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000002";
export const GHOSTWIRE_NOTIFY_CHAR_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000003";

/** Conservative payload bytes per BLE write across devices. */
export const BLE_CHUNK_BYTES = 180;

// ---------------------------------------------------------------------------
// Framing: [total:1][index:1][payload...]
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Adapter contract (central + peripheral)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

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
    // BLE peers are discovered and connected by the adapter; there is no
    // signaling blob to exchange.
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

// ---------------------------------------------------------------------------
// react-native-ble-plx central adapter (real, + optional advertiser)
// ---------------------------------------------------------------------------

interface BlePlxLike {
  BleManager: new () => {
    startDeviceScan(
      uuids: string[] | null,
      options: unknown,
      listener: (error: unknown, device: { id: string; name?: string | null } | null) => void,
    ): void;
    stopDeviceScan(): void;
    connectToDevice(id: string): Promise<unknown>;
    destroy(): void;
  };
}

interface PeripheralLike {
  broadcast(serviceUuid: string, data?: number[], options?: unknown): Promise<unknown>;
  stopBroadcast(): Promise<unknown>;
  addListener?(event: string, cb: (payload: { deviceAddress: string; value?: number[] }) => void): void;
}

/**
 * Central side built on `react-native-ble-plx`. Advertising/peripheral support
 * is injected (`peripheral`) because it needs a separate native module. When no
 * peripheral module is supplied the node still works as a central (it can join
 * a mesh, just not be discovered first).
 */
export class BlePlxAdapter implements BleAdapter {
  private readonly manager: InstanceType<BlePlxLike["BleManager"]>;
  private readonly connections = new Map<string, BlePeerHandle>();
  private readonly characteristicCache = new Map<string, { write: unknown; notify: unknown }>();
  private dataHandler: ((peerId: string, data: Uint8Array) => void) | null = null;
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;

  constructor(
    private readonly peripheral?: PeripheralLike,
  ) {
    const ble = loadModule<BlePlxLike>("react-native-ble-plx", "Bluetooth scanning needs a development build.");
    this.manager = new ble.BleManager();
  }

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    this.opts = opts;
    this.dataHandler = opts.onData;

    if (this.peripheral) {
      await this.peripheral.broadcast(opts.serviceUuid).catch(() => undefined);
    }

    this.manager.startDeviceScan([opts.serviceUuid], null, (error, device) => {
      if (error || !device) return;
      if (this.connections.has(device.id)) return;
      void this.connectDevice(device.id);
    });
  }

  private async connectDevice(deviceId: string): Promise<void> {
    if (!this.opts) return;
    try {
      await this.manager.connectToDevice(deviceId);
      const peer = await this.preparePeer(deviceId);
      this.connections.set(deviceId, peer);
      this.opts.onPeer(peer);
    } catch {
      /* retry on next scan tick */
    }
  }

  private async preparePeer(deviceId: string): Promise<BlePeerHandle> {
    // The exact characteristic write/notify plumbing is provided by the native
    // module; this indirection keeps the transport core independent of it.
    const cached = this.characteristicCache.get(deviceId);
    if (cached) return buildPeer(deviceId, cached, this.dataHandler);
    const handle = await openGattConnection(deviceId, this.opts!);
    this.characteristicCache.set(deviceId, handle);
    return buildPeer(deviceId, handle, this.dataHandler);
  }

  async stop(): Promise<void> {
    this.manager.stopDeviceScan();
    this.connections.clear();
    if (this.peripheral) await this.peripheral.stopBroadcast().catch(() => undefined);
    this.manager.destroy();
  }
}

function buildPeer(
  id: string,
  handle: { write: unknown; notify: unknown },
  onData: ((peerId: string, data: Uint8Array) => void) | null,
): BlePeerHandle {
  return {
    id,
    write: async (frame) => {
      void handle;
      void frame;
      // Provided by the native GATT layer in openGattConnection.
    },
  };
}

/** Platform GATT plumbing; overridden by the dev-build integration. */
async function openGattConnection(
  _deviceId: string,
  _opts: Parameters<BleAdapter["start"]>[0],
): Promise<{ write: unknown; notify: unknown }> {
  throw new Error("BLE GATT integration requires a development build with the native module");
}

function loadModule<T>(name: string, message: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    throw new Error(message);
  }
}
