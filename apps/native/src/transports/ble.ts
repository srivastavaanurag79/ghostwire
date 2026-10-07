import { PermissionsAndroid, Platform } from "react-native";
import { fromBase64, toBase64 } from "@ghostwire/crypto";
import {
  addCharacteristicToService,
  addService,
  ATTError,
  CharacteristicPermissions,
  CharacteristicProperties,
  getState,
  ManagerState,
  onDidReceiveWriteRequests,
  onDidSubscribeToCharacteristic,
  onDidUnsubscribeFromCharacteristic,
  respondToRequest,
  startAdvertising,
  stopAdvertising,
  updateValueBase64,
  type EventDidReceiveWriteRequests,
} from "react-native-ble-peripheral-manager";
import {
  GHOSTWIRE_NOTIFY_CHAR_UUID,
  GHOSTWIRE_SERVICE_UUID,
  GHOSTWIRE_WRITE_CHAR_UUID,
  type BleAdapter,
  type BlePeerHandle,
} from "@ghostwire/transport";

/**
 * React Native BLE adapter for GhostWire's dual-role mesh.
 *
 * Two libraries cover the two radio roles:
 *  - peripheral (`react-native-ble-peripheral-manager`): advertise + GATT
 *    server, notify subscribers, answer write requests.
 *  - central (`react-native-ble-plx`): scan, connect, subscribe, write.
 *
 * To avoid two links between the same pair (which would duplicate frames), the
 * initiator is chosen deterministically: the node with the smaller id connects,
 * the other only serves. Each pair then has exactly one link carrying data both
 * ways — writes on WRITE, notifications on NOTIFY. Both libraries are native
 * modules, so this only runs in a dev/standalone build (not Expo Go).
 */
export { BleTransport } from "@ghostwire/transport";
export { GHOSTWIRE_SERVICE_UUID, GHOSTWIRE_WRITE_CHAR_UUID, GHOSTWIRE_NOTIFY_CHAR_UUID };
export type { BleAdapter, BlePeerHandle };

const NODE_NAME_PREFIX = "GW";
const NODE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const NODE_ID_LENGTH = 6;
/** GhostWire frames are chunked to 180 bytes; negotiate a large MTU for them. */
const REQUESTED_MTU = 517;

interface PlxCharacteristic {
  uuid: string;
  value?: string | null;
  monitor(cb: (error: unknown, characteristic: PlxCharacteristic | null) => void): void;
  writeWithoutResponse(valueBase64: string): Promise<unknown>;
  writeWithResponse(valueBase64: string): Promise<unknown>;
}

interface PlxDevice {
  id: string;
  localName?: string | null;
  name?: string | null;
  discoverAllServicesAndCharacteristics(): Promise<unknown>;
  characteristicsForService(uuid: string): Promise<PlxCharacteristic[]>;
  cancelConnection(): Promise<unknown>;
  requestMTU(mtu: number): Promise<unknown>;
}

interface PlxBleManager {
  startDeviceScan(
    uuids: string[] | null,
    options: unknown,
    listener: (error: unknown, device: PlxDevice | null) => void,
  ): void;
  stopDeviceScan(): void;
  connectToDevice(id: string, options?: unknown): Promise<PlxDevice>;
  cancelDeviceConnection(id: string): Promise<unknown>;
  enableBluetooth?(): Promise<unknown>;
  destroy(): void;
}

type PeerRole = "central" | "peripheral";

function newNodeId(): string {
  let id = "";
  for (let i = 0; i < NODE_ID_LENGTH; i++) {
    id += NODE_ID_ALPHABET[Math.floor(Math.random() * NODE_ID_ALPHABET.length)]!;
  }
  return id;
}

async function requestBlePermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const version = typeof Platform.Version === "number" ? Platform.Version : 0;
  if (version >= 31) {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    ]);
  } else {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }
}

export class DualRoleBleAdapter implements BleAdapter {
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;
  private manager: PlxBleManager | null = null;
  private nodeId = "";
  private started = false;
  private readonly roles = new Map<string, PeerRole>();
  private readonly connecting = new Set<string>();
  private readonly centralPeers = new Map<string, PlxDevice>();
  private readonly disposers: Array<() => void> = [];

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.opts = opts;
    this.nodeId = newNodeId();

    await requestBlePermissions();

    // Static require keeps Metro happy (no dynamic requires).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plx = require("react-native-ble-plx") as {
      BleManager: new () => PlxBleManager;
    };
    this.manager = new plx.BleManager();
    await this.ensureBluetoothOn();

    // Peripheral half: GATT server + advertising.
    addService(opts.serviceUuid, true);
    addCharacteristicToService(
      opts.serviceUuid,
      opts.writeCharUuid,
      CharacteristicProperties.Write | CharacteristicProperties.WriteWithoutResponse,
      CharacteristicPermissions.Writeable,
      "",
    );
    addCharacteristicToService(
      opts.serviceUuid,
      opts.notifyCharUuid,
      CharacteristicProperties.Read | CharacteristicProperties.Notify,
      CharacteristicPermissions.Readable,
      "",
    );

    const peripheralSubscriptions = [
      onDidSubscribeToCharacteristic((e) => this.ensurePeer(e.centralUUID, "peripheral")),
      onDidUnsubscribeFromCharacteristic((e) => this.dropPeer(e.centralUUID)),
      onDidReceiveWriteRequests((e) => this.onWriteRequests(e)),
    ];
    for (const subscription of peripheralSubscriptions) {
      this.disposers.push(() => subscription.remove());
    }

    await startAdvertising({
      localName: `${NODE_NAME_PREFIX}${this.nodeId}`,
      serviceUUIDs: [opts.serviceUuid],
    });

    // Central half: scan for other GhostWire nodes.
    this.manager.startDeviceScan([opts.serviceUuid], { allowDuplicates: false }, (error, device) => {
      if (error || !device) return;
      this.onDeviceFound(device);
    });
  }

  /**
   * Bluetooth is often off when a session starts. Ask the OS to enable it (the
   * Android enable dialog), then wait until the adapter reports PoweredOn.
   */
  private async ensureBluetoothOn(): Promise<void> {
    for (let attempt = 0; attempt < 24; attempt++) {
      const state = await getState().catch(() => ManagerState.PoweredOn);
      if (state === ManagerState.PoweredOn) return;
      if (state === ManagerState.Unsupported || state === ManagerState.Unauthorized) {
        throw new Error("Bluetooth is not available on this device");
      }
      if (attempt === 0) {
        await this.manager?.enableBluetooth?.().catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Bluetooth is turned off");
  }

  private onWriteRequests(e: EventDidReceiveWriteRequests): void {
    const opts = this.opts;
    if (!opts) return;
    for (const request of e.requests) {
      if (request.characteristicUUID.toLowerCase() !== opts.writeCharUuid.toLowerCase()) continue;
      this.ensurePeer(request.centralUUID, "peripheral");
      opts.onData(request.centralUUID, fromBase64(request.value));
    }
    if (e.requests.length > 0) respondToRequest(e.requestId, ATTError.Success);
  }

  /** Only the smaller node id initiates; the other just serves. */
  private onDeviceFound(device: PlxDevice): void {
    const remoteId = this.remoteNodeId(device);
    if (!remoteId) return;
    if (this.roles.has(device.id) || this.connecting.has(device.id)) return;
    if (this.nodeId >= remoteId) return;
    void this.connectCentral(device.id);
  }

  private async connectCentral(deviceId: string): Promise<void> {
    const opts = this.opts;
    if (!this.manager || !opts) return;
    this.connecting.add(deviceId);
    try {
      const device = await this.manager.connectToDevice(deviceId, { autoConnect: false });
      await device.discoverAllServicesAndCharacteristics();
      await device.requestMTU(REQUESTED_MTU).catch(() => undefined);
      const characteristics = await device.characteristicsForService(opts.serviceUuid);
      const write = characteristics.find(
        (c) => c.uuid.toLowerCase() === opts.writeCharUuid.toLowerCase(),
      );
      const notify = characteristics.find(
        (c) => c.uuid.toLowerCase() === opts.notifyCharUuid.toLowerCase(),
      );
      if (!write || !notify) throw new Error("GhostWire GATT characteristics missing");

      notify.monitor((error, characteristic) => {
        if (error || !characteristic?.value) return;
        opts.onData(deviceId, fromBase64(characteristic.value));
      });

      this.centralPeers.set(deviceId, device);
      this.roles.set(deviceId, "central");
      opts.onPeer({ id: deviceId, write: (frame) => this.writeCentral(device, frame) });
    } catch {
      await this.manager.cancelDeviceConnection(deviceId).catch(() => undefined);
    } finally {
      this.connecting.delete(deviceId);
    }
  }

  private async writeCentral(device: PlxDevice, frame: Uint8Array): Promise<void> {
    const opts = this.opts;
    if (!opts) return;
    const characteristics = await device.characteristicsForService(opts.serviceUuid);
    const write = characteristics.find(
      (c) => c.uuid.toLowerCase() === opts.writeCharUuid.toLowerCase(),
    );
    if (!write) return;
    const value = toBase64(frame);
    await write.writeWithoutResponse(value).catch(() => write.writeWithResponse(value));
  }

  private ensurePeer(id: string, role: PeerRole): void {
    if (this.roles.has(id) || !this.opts) return;
    this.roles.set(id, role);
    this.opts.onPeer({ id, write: (frame) => this.writePeer(id, role, frame) });
  }

  private async writePeer(id: string, role: PeerRole, frame: Uint8Array): Promise<void> {
    const opts = this.opts;
    if (!opts) return;
    if (role === "central") {
      const device = this.centralPeers.get(id);
      if (device) await this.writeCentral(device, frame);
      return;
    }
    await updateValueBase64(opts.serviceUuid, opts.notifyCharUuid, toBase64(frame)).catch(
      () => false,
    );
  }

  private dropPeer(id: string): void {
    if (!this.roles.delete(id)) return;
    this.centralPeers.delete(id);
    this.opts?.onPeerLost(id);
  }

  private remoteNodeId(device: PlxDevice): string | null {
    const name = device.localName ?? device.name;
    if (!name || !name.startsWith(NODE_NAME_PREFIX)) return null;
    const id = name.slice(NODE_NAME_PREFIX.length);
    return id.length > 0 ? id : null;
  }

  async stop(): Promise<void> {
    this.started = false;
    try {
      this.manager?.stopDeviceScan();
      for (const device of this.centralPeers.values()) {
        await device.cancelConnection().catch(() => undefined);
      }
      this.manager?.destroy();
    } catch {
      // Manager already torn down.
    }
    this.manager = null;
    try {
      stopAdvertising();
    } catch {
      // Advertiser already stopped.
    }
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        // Listener already detached.
      }
    }
    this.disposers.length = 0;
    this.roles.clear();
    this.centralPeers.clear();
    this.connecting.clear();
    this.opts = null;
  }
}

/** Dual-role mesh adapter: plx (central) + peripheral-manager (peripheral). */
export function createBleAdapter(): DualRoleBleAdapter {
  return new DualRoleBleAdapter();
}
