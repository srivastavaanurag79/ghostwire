import { BaseTransport, type SignalingData } from "@ghostwire/transport";

/**
 * Bluetooth Low Energy mesh transport (work in progress).
 *
 * Goal: phones relay encrypted messages with no internet and no hotspot. This
 * is the transport that makes GhostWire usable during a network shutdown.
 *
 * Design (see docs/ARCHITECTURE.md):
 *  - One custom GATT service, two characteristics: a "write" characteristic
 *    peers write frames to, and a "notify" characteristic peers subscribe to.
 *  - Each device advertises the service with a rotating, session-scoped
 *    identifier (never a stable hardware address).
 *  - Frames are fragmented to the negotiated MTU (max ~512 bytes; chunk ~180).
 *  - The mesh layer already provides TTL, dedup and end-to-end encryption, so
 *    this transport only needs to move opaque bytes between BLE peers.
 *
 * Requires `react-native-ble-plx` and a development build (not Expo Go).
 * Android can keep the mesh alive with a foreground service; iOS background BLE
 * is limited and should be treated as foreground-only.
 */
export const GHOSTWIRE_SERVICE_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000001";
export const GHOSTWIRE_WRITE_CHAR_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000002";
export const GHOSTWIRE_NOTIFY_CHAR_UUID = "6b6f7374-7769-7265-2d62-6c65-000000000003";

/** Max bytes per BLE write, conservative across devices. */
export const BLE_CHUNK_BYTES = 180;

interface BlePlx {
  BleManager: new () => unknown;
}

export class BleTransport extends BaseTransport {
  private started = false;
  private readonly peers = new Set<string>();
  private manager: unknown = null;

  get peerIds(): readonly string[] {
    return [...this.peers];
  }

  /** Advertise + scan for peers carrying the GhostWire service. */
  async start(): Promise<void> {
    if (this.started) return;
    const ble = loadBlePlx();
    this.manager = new ble.BleManager();
    this.started = true;
    // TODO: start advertising the service and scanning; on discovery, connect,
    // discover characteristics, subscribe to notify, and emit join.
  }

  connect(_peerId: string, _signaling?: SignalingData): Promise<void> {
    // BLE peers are discovered, not dialed with a signaling blob.
    throw new Error("BleTransport.connect is handled by discovery; not available yet");
  }

  send(peerId: string, data: Uint8Array): void {
    void peerId;
    void data;
    // TODO: fragment `data` into BLE_CHUNK_BYTES and write to the peer's
    // write characteristic, awaiting the write acknowledgement.
  }

  broadcast(data: Uint8Array, exceptPeerId?: string): void {
    for (const id of this.peers) {
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
    for (const id of [...this.peers]) {
      this.peers.delete(id);
      this.emitLeave(id);
    }
    this.started = false;
    this.manager = null;
  }
}

function loadBlePlx(): BlePlx {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-ble-plx") as BlePlx;
  } catch {
    throw new Error(
      "Bluetooth mesh needs a development build with react-native-ble-plx installed.",
    );
  }
}
