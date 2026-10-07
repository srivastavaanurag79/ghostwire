import { fromBase64, toBase64 } from "@ghostwire/crypto";
import {
  GHOSTWIRE_NOTIFY_CHAR_UUID,
  GHOSTWIRE_SERVICE_UUID,
  GHOSTWIRE_WRITE_CHAR_UUID,
  type BleAdapter,
  type BlePeerHandle,
} from "@ghostwire/transport";

/**
 * React Native BLE adapter (central role) built on `react-native-ble-plx`.
 *
 * The transport core (framing, reassembly, peer bookkeeping) lives in
 * `@ghostwire/transport` and is unit-tested with a fake adapter, so this file
 * only contains the platform radio plumbing. Advertising/peripheral support is
 * in `ble-peripheral.ts`.
 */
export { BleTransport } from "@ghostwire/transport";
export { GHOSTWIRE_SERVICE_UUID, GHOSTWIRE_WRITE_CHAR_UUID, GHOSTWIRE_NOTIFY_CHAR_UUID };
export type { BleAdapter, BlePeerHandle };

interface BleDeviceLike {
  id: string;
  discoverAllServicesAndCharacteristics(): Promise<unknown>;
  characteristicsForService(uuid: string): Promise<BleCharacteristicLike[]>;
  cancelConnection(): Promise<unknown>;
}

interface BleCharacteristicLike {
  uuid: string;
  value?: string | null;
  monitor(cb: (error: unknown, characteristic: BleCharacteristicLike | null) => void): void;
  writeWithResponse(valueBase64: string): Promise<unknown>;
  writeWithoutResponse?(valueBase64: string): Promise<unknown>;
}

interface BleManagerLike {
  startDeviceScan(
    uuids: string[] | null,
    options: unknown,
    listener: (error: unknown, device: BleDeviceLike | null) => void,
  ): void;
  stopDeviceScan(): void;
  connectToDevice(id: string, options?: unknown): Promise<BleDeviceLike>;
  destroy(): void;
}

interface PeripheralLike {
  broadcast(serviceUuid: string, data?: number[], options?: unknown): Promise<unknown>;
  stopBroadcast(): Promise<unknown>;
}

export interface BlePlxAdapterOptions {
  /** True to emit `writeWithoutResponse` when available (lower latency). */
  preferWriteWithoutResponse?: boolean;
}

export class BlePlxAdapter implements BleAdapter {
  private manager: BleManagerLike | null = null;
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;
  private readonly peers = new Map<string, { device: BleDeviceLike; write: BleCharacteristicLike }>();

  constructor(
    private readonly peripheral?: PeripheralLike,
    private readonly adapterOptions: BlePlxAdapterOptions = {},
  ) {}

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    this.opts = opts;
    const ble = loadModule<{ BleManager: new () => BleManagerLike }>(
      "react-native-ble-plx",
      "Bluetooth needs a development build with react-native-ble-plx.",
    );
    this.manager = new ble.BleManager();

    if (this.peripheral) {
      await this.peripheral.broadcast(opts.serviceUuid).catch(() => undefined);
    }

    this.manager.startDeviceScan([opts.serviceUuid], { allowDuplicates: false }, (error, device) => {
      if (error || !device || this.peers.has(device.id)) return;
      void this.connect(device.id);
    });
  }

  private async connect(deviceId: string): Promise<void> {
    if (!this.manager || !this.opts) return;
    const opts = this.opts;
    try {
      const device = await this.manager.connectToDevice(deviceId, { autoConnect: false });
      await device.discoverAllServicesAndCharacteristics();
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

      this.peers.set(deviceId, { device, write });
      const preferWrite = this.adapterOptions.preferWriteWithoutResponse !== false;
      opts.onPeer({
        id: deviceId,
        write: async (frame) => {
          const value = toBase64(frame);
          if (preferWrite && typeof write.writeWithoutResponse === "function") {
            await write.writeWithoutResponse(value);
          } else {
            await write.writeWithResponse(value);
          }
        },
      });
    } catch {
      // Leave it to the next scan tick.
    }
  }

  async stop(): Promise<void> {
    this.manager?.stopDeviceScan();
    for (const peer of this.peers.values()) await peer.device.cancelConnection().catch(() => undefined);
    this.peers.clear();
    if (this.peripheral) await this.peripheral.stopBroadcast().catch(() => undefined);
    this.manager?.destroy();
    this.manager = null;
  }
}

function loadModule<T>(name: string, message: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    throw new Error(message);
  }
}
