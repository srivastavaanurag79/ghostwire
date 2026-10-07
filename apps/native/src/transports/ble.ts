import {
  addDeviceFoundListener,
  addEventListener,
  connect,
  disconnect,
  discoverServices,
  isBluetoothEnabled,
  requestBluetoothPermission,
  requestEnable,
  requestMTU,
  setServices,
  startAdvertising,
  startScan,
  stopAdvertising,
  stopScan,
  subscribeToCharacteristic,
  updateCharacteristicValue,
  writeCharacteristic,
  type BLEDevice,
  type BluetoothEventMap,
  type CharacteristicValue,
} from "munim-bluetooth";
import {
  GHOSTWIRE_NOTIFY_CHAR_UUID,
  GHOSTWIRE_SERVICE_UUID,
  GHOSTWIRE_WRITE_CHAR_UUID,
  type BleAdapter,
  type BlePeerHandle,
} from "@ghostwire/transport";

/**
 * React Native BLE adapter built on `munim-bluetooth` (Nitro modules).
 *
 * A GhostWire node is dual-role: it advertises a GATT server *and* scans for
 * other nodes. To avoid two links between the same pair of phones (which would
 * duplicate every frame), the initiator is chosen deterministically: the node
 * with the lexicographically smaller id connects, the other only serves. Each
 * pair therefore ends up with exactly one link, carrying data both ways — writes
 * on the WRITE characteristic, notifications on the NOTIFY characteristic.
 *
 * The platform-agnostic framing/reassembly lives in `@ghostwire/transport`, so
 * this file is only radio plumbing.
 */
export { BleTransport } from "@ghostwire/transport";
export { GHOSTWIRE_SERVICE_UUID, GHOSTWIRE_WRITE_CHAR_UUID, GHOSTWIRE_NOTIFY_CHAR_UUID };
export type { BleAdapter, BlePeerHandle };

const HEX = "0123456789abcdef";
const NODE_NAME_PREFIX = "GW";
const NODE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const NODE_ID_LENGTH = 6;
/** GhostWire frames are chunked to 180 bytes; a big MTU keeps them in one write. */
const REQUESTED_MTU = 517;

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    out += HEX[(byte >> 4) & 0xf]! + HEX[byte & 0xf]!;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function newNodeId(): string {
  let id = "";
  for (let i = 0; i < NODE_ID_LENGTH; i++) {
    id += NODE_ID_ALPHABET[Math.floor(Math.random() * NODE_ID_ALPHABET.length)]!;
  }
  return id;
}

type PeerRole = "central" | "peripheral";

export class MunimBleAdapter implements BleAdapter {
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;
  private readonly roles = new Map<string, PeerRole>();
  private readonly connecting = new Set<string>();
  private readonly dispose: Array<() => void> = [];
  private nodeId = "";
  private started = false;

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.opts = opts;
    this.nodeId = newNodeId();

    const granted = await requestBluetoothPermission(["scan", "connect", "advertise"]);
    if (!granted) throw new Error("Bluetooth permission was denied");
    if (!(await isBluetoothEnabled())) {
      await requestEnable();
      if (!(await isBluetoothEnabled())) throw new Error("Bluetooth is turned off");
    }

    setServices([
      {
        uuid: opts.serviceUuid,
        characteristics: [
          { uuid: opts.writeCharUuid, properties: ["write", "writeWithoutResponse"] },
          { uuid: opts.notifyCharUuid, properties: ["read", "notify"] },
        ],
      },
    ]);

    this.dispose.push(
      addEventListener("peripheralWriteRequest", (e) => this.onPeripheralWrite(e)),
      addEventListener("peripheralSubscribed", (e) => this.ensurePeer(e.centralId, "peripheral")),
      addEventListener("peripheralUnsubscribed", (e) => this.dropPeer(e.centralId)),
      addEventListener("characteristicValueChanged", (e) => this.onNotify(e)),
      addEventListener("deviceDisconnected", (e) => this.dropPeer(e.deviceId)),
      addDeviceFoundListener((device) => this.onDeviceFound(device)),
    );

    startAdvertising({
      serviceUUIDs: [opts.serviceUuid],
      localName: `${NODE_NAME_PREFIX}${this.nodeId}`,
    });
    startScan({
      serviceUUIDs: [opts.serviceUuid],
      allowDuplicates: false,
      scanMode: "lowLatency",
    });
  }

  /** Only the smaller node id initiates; the other just serves. */
  private onDeviceFound(device: BLEDevice): void {
    const remoteId = this.remoteNodeId(device);
    if (!remoteId) return;
    if (this.roles.has(device.id) || this.connecting.has(device.id)) return;
    if (this.nodeId >= remoteId) return;
    void this.connectCentral(device.id);
  }

  private async connectCentral(deviceId: string): Promise<void> {
    const opts = this.opts;
    if (!opts) return;
    this.connecting.add(deviceId);
    try {
      await connect(deviceId, { timeoutMs: 12000 });
      await requestMTU(deviceId, REQUESTED_MTU).catch(() => 23);
      await discoverServices(deviceId);
      await subscribeToCharacteristic(deviceId, opts.serviceUuid, opts.notifyCharUuid);
      this.ensurePeer(deviceId, "central");
    } catch {
      try {
        disconnect(deviceId);
      } catch {
        // Already gone.
      }
    } finally {
      this.connecting.delete(deviceId);
    }
  }

  private onPeripheralWrite(e: BluetoothEventMap["peripheralWriteRequest"]): void {
    const opts = this.opts;
    if (!opts) return;
    if (e.characteristicUUID.toLowerCase() !== opts.writeCharUuid.toLowerCase()) return;
    this.ensurePeer(e.centralId, "peripheral");
    opts.onData(e.centralId, hexToBytes(e.value));
  }

  private onNotify(e: CharacteristicValue & { deviceId: string }): void {
    const opts = this.opts;
    if (!opts) return;
    if (e.characteristicUUID.toLowerCase() !== opts.notifyCharUuid.toLowerCase()) return;
    if (this.roles.get(e.deviceId) !== "central") return;
    opts.onData(e.deviceId, hexToBytes(e.value));
  }

  private ensurePeer(id: string, role: PeerRole): void {
    if (this.roles.has(id) || !this.opts) return;
    this.roles.set(id, role);
    this.opts.onPeer({
      id,
      write: (frame) => this.writePeer(id, role, frame),
    });
  }

  private async writePeer(id: string, role: PeerRole, frame: Uint8Array): Promise<void> {
    const opts = this.opts;
    if (!opts) return;
    if (role === "central") {
      await writeCharacteristic(
        id,
        opts.serviceUuid,
        opts.writeCharUuid,
        bytesToHex(frame),
        "writeWithoutResponse",
      );
      return;
    }
    await updateCharacteristicValue(opts.serviceUuid, opts.notifyCharUuid, bytesToHex(frame), true);
  }

  private dropPeer(id: string): void {
    if (!this.roles.delete(id)) return;
    this.opts?.onPeerLost(id);
  }

  private remoteNodeId(device: BLEDevice): string | null {
    const name = device.localName ?? device.name;
    if (!name || !name.startsWith(NODE_NAME_PREFIX)) return null;
    const id = name.slice(NODE_NAME_PREFIX.length);
    return id.length > 0 ? id : null;
  }

  async stop(): Promise<void> {
    this.started = false;
    stopScan();
    stopAdvertising();
    for (const off of this.dispose) {
      try {
        off();
      } catch {
        // Listener already detached.
      }
    }
    this.dispose.length = 0;
    for (const [id, role] of this.roles) {
      if (role !== "central") continue;
      try {
        disconnect(id);
      } catch {
        // Already disconnected.
      }
    }
    this.roles.clear();
    this.connecting.clear();
    this.opts = null;
  }
}

/** Dual-role mesh adapter backed by `munim-bluetooth`. */
export function createBleAdapter(): MunimBleAdapter {
  return new MunimBleAdapter();
}
