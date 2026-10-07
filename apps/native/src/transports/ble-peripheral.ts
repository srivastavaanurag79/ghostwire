import { BlePlxAdapter, type BleAdapter, type BlePeerHandle } from "./ble";

/**
 * Peripheral (advertising + GATT-server) half of the BLE mesh, plus a
 * dual-role adapter that combines it with the central half.
 *
 * `react-native-ble-plx` is central-only, so a mesh node also needs a
 * peripheral/GATT-server module. This is written against the API exposed by
 * `react-native-ble-peripheral`, but the module boundary is isolated so any
 * equivalent module can be dropped in.
 *
 * Needs a development build with the native module installed.
 */
const PERMISSION_READ = 0x01;
const PERMISSION_WRITE = 0x10;
const PROPERTY_WRITE_NO_RESPONSE = 0x04;
const PROPERTY_WRITE = 0x08;
const PROPERTY_NOTIFY = 0x10;

interface BlePeripheralModule {
  addService(uuid: string, primary: boolean): void;
  addCharacteristicToService(
    serviceUuid: string,
    characteristicUuid: string,
    permissions: number,
    properties: number,
  ): void;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  sendNotificationToDevices(serviceUuid: string, characteristicUuid: string, data: number[]): void;
  on(event: string, cb: (payload: unknown) => void): void;
}

export class BlePeripheralAdapter implements BleAdapter {
  private module: BlePeripheralModule | null = null;
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;
  private readonly known = new Set<string>();

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    this.opts = opts;
    this.module = loadModule();
    const ble = this.module;

    ble.addService(opts.serviceUuid, true);
    ble.addCharacteristicToService(
      opts.serviceUuid,
      opts.writeCharUuid,
      PERMISSION_WRITE | PERMISSION_READ,
      PROPERTY_WRITE | PROPERTY_WRITE_NO_RESPONSE,
    );
    ble.addCharacteristicToService(
      opts.serviceUuid,
      opts.notifyCharUuid,
      PERMISSION_READ,
      PROPERTY_NOTIFY,
    );
    await ble.start();

    ble.on("write", (payload) => {
      const { deviceAddress, data } = payload as { deviceAddress?: string; data?: number[] };
      if (!deviceAddress || !data) return;
      this.ensurePeer(deviceAddress);
      opts.onData(deviceAddress, Uint8Array.from(data));
    });

    ble.on("subscribe", (payload) => {
      const { deviceAddress } = payload as { deviceAddress?: string };
      if (deviceAddress) this.ensurePeer(deviceAddress);
    });

    ble.on("disconnect", (payload) => {
      const { deviceAddress } = payload as { deviceAddress?: string };
      if (deviceAddress && this.known.delete(deviceAddress)) opts.onPeerLost(deviceAddress);
    });
  }

  private ensurePeer(peerId: string): void {
    if (this.known.has(peerId) || !this.opts) return;
    this.known.add(peerId);
    const peer: BlePeerHandle = {
      id: peerId,
      write: async (frame) => {
        // Peripheral -> central is a notification on the notify characteristic.
        this.module?.sendNotificationToDevices(
          this.opts!.serviceUuid,
          this.opts!.notifyCharUuid,
          Array.from(frame),
        );
      },
    };
    this.opts.onPeer(peer);
  }

  async stop(): Promise<void> {
    await this.module?.stop().catch(() => undefined);
    this.known.clear();
    this.module = null;
  }
}

/**
 * Combine a central adapter with the peripheral adapter so a phone both
 * discovers others and is discoverable — a true dual-role mesh node. Peer and
 * data events from both halves are de-duplicated by peer id.
 */
export class DualRoleBleAdapter implements BleAdapter {
  constructor(
    private readonly central: BleAdapter,
    private readonly peripheral: BleAdapter,
  ) {}

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    const seen = new Set<string>();
    const shared = {
      ...opts,
      onPeer: (peer: BlePeerHandle) => {
        if (seen.has(peer.id)) return;
        seen.add(peer.id);
        opts.onPeer(peer);
      },
      onPeerLost: (id: string) => {
        seen.delete(id);
        opts.onPeerLost(id);
      },
    };
    await Promise.all([this.central.start(shared), this.peripheral.start(shared)]);
  }

  async stop(): Promise<void> {
    await Promise.all([this.central.stop(), this.peripheral.stop()]);
  }
}

/** Dual-role mesh adapter: central (ble-plx) + peripheral (advertising/GATT). */
export function createDualRoleAdapter(): DualRoleBleAdapter {
  return new DualRoleBleAdapter(new BlePlxAdapter(), new BlePeripheralAdapter());
}

function loadModule(): BlePeripheralModule {
  // Static require (Metro rejects dynamic requires).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("react-native-ble-peripheral") as BlePeripheralModule;
}
