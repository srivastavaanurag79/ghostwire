import { fromBase64, toBase64 } from "@ghostwire/crypto";
import {
  BleTransport,
  GHOSTWIRE_NOTIFY_CHAR_UUID,
  GHOSTWIRE_SERVICE_UUID,
  GHOSTWIRE_WRITE_CHAR_UUID,
  type BleAdapter,
  type BlePeerHandle,
} from "@ghostwire/transport";
import { BleManager } from "@syncmesh/rn-ble";
import type { BleScanResult } from "@syncmesh/rn-ble";

/**
 * Bluetooth LE adapter built on `@syncmesh/rn-ble` (an Expo Module with both
 * central and peripheral roles). A node advertises + scans, so devices form a
 * mesh with no internet, no router, and no hotspot.
 *
 * The transport core (framing/reassembly/peer bookkeeping) lives in
 * `@ghostwire/transport` and is unit-tested; this file is only radio plumbing.
 */
export { BleTransport, GHOSTWIRE_SERVICE_UUID, GHOSTWIRE_WRITE_CHAR_UUID, GHOSTWIRE_NOTIFY_CHAR_UUID };
export type { BleAdapter, BlePeerHandle };

type BleManagerType = typeof BleManager;

export class RnBleAdapter implements BleAdapter {
  private opts: Parameters<BleAdapter["start"]>[0] | null = null;
  private readonly connections = new Map<string, string>(); // peripheralId -> connectionId
  private readonly centralIds = new Set<string>();
  private started = false;

  async start(opts: Parameters<BleAdapter["start"]>[0]): Promise<void> {
    this.opts = opts;
    const state = await BleManager.getState();
    if (state !== "poweredOn") {
      throw new Error(`Bluetooth is not ready (${state}).`);
    }

    this.subscribeToEvents();

    // Peripheral: publish our GATT service and advertise it.
    try {
      await BleManager.publishServices({
        services: [
          {
            uuid: GHOSTWIRE_SERVICE_UUID,
            characteristics: [
              {
                uuid: GHOSTWIRE_WRITE_CHAR_UUID,
                properties: ["write", "writeWithoutResponse"],
                permissions: ["writeable"],
                initialValueBase64: "",
              },
              {
                uuid: GHOSTWIRE_NOTIFY_CHAR_UUID,
                properties: ["notify"],
                permissions: ["readable"],
                initialValueBase64: "",
              },
            ],
          },
        ],
      });
      await BleManager.startAdvertising({
        localName: "GhostWire",
        serviceUuids: [GHOSTWIRE_SERVICE_UUID],
      });
    } catch {
      // Advertising can fail on some devices; central scanning still works.
    }

    // Central: scan for peers advertising our service.
    await BleManager.startScan({ serviceUuids: [GHOSTWIRE_SERVICE_UUID] });
    this.started = true;
  }

  private subscribeToEvents(): void {
    const manager = BleManager as unknown as {
      addListener?: (event: string, cb: (payload: unknown) => void) => { remove(): void };
    };
    if (!manager.addListener) return;

    manager.addListener("onScanResult", (payload) => {
      void this.onScanResult(payload as BleScanResult);
    });
    manager.addListener("onCharacteristicValueChanged", (payload) => {
      const e = payload as { peripheralId: string; valueBase64: string };
      if (this.opts) this.opts.onData(e.peripheralId, fromBase64(e.valueBase64));
    });
    manager.addListener("onCharacteristicWriteRequested", (payload) => {
      const e = payload as { centralId?: string; valueBase64: string };
      const id = e.centralId ?? "central";
      this.ensureCentralPeer(id);
      if (this.opts) this.opts.onData(id, fromBase64(e.valueBase64));
    });
    manager.addListener("onSubscribersChanged", (payload) => {
      const e = payload as { centralIds: ReadonlyArray<string> };
      for (const id of e.centralIds) this.ensureCentralPeer(id);
    });
    manager.addListener("onConnectionStateChanged", (payload) => {
      const e = payload as { peripheralId: string; state: string };
      if (e.state === "disconnected" && this.connections.has(e.peripheralId)) {
        this.connections.delete(e.peripheralId);
        this.opts?.onPeerLost(e.peripheralId);
      }
    });
  }

  private async onScanResult(result: BleScanResult): Promise<void> {
    if (!this.opts || this.connections.has(result.peripheralId)) return;
    const peripheralId = result.peripheralId;
    this.connections.set(peripheralId, ""); // claim to avoid duplicate connects
    try {
      const connection = await BleManager.connect(peripheralId);
      const discovery = await BleManager.discoverServices(connection.connectionId);
      const service = discovery.services.find((s) => s.uuid.toLowerCase() === GHOSTWIRE_SERVICE_UUID);
      const hasWrite = service?.characteristics.some(
        (c) => c.uuid.toLowerCase() === GHOSTWIRE_WRITE_CHAR_UUID,
      );
      if (!hasWrite) throw new Error("not a GhostWire peer");
      await BleManager.subscribe(
        connection.connectionId,
        GHOSTWIRE_SERVICE_UUID,
        GHOSTWIRE_NOTIFY_CHAR_UUID,
      );
      this.connections.set(peripheralId, connection.connectionId);
      const connectionId = connection.connectionId;
      this.opts.onPeer({
        id: peripheralId,
        write: async (frame) => {
          await BleManager.write(
            connectionId,
            GHOSTWIRE_SERVICE_UUID,
            GHOSTWIRE_WRITE_CHAR_UUID,
            toBase64(frame),
            "withoutResponse",
          );
        },
      });
    } catch {
      this.connections.delete(peripheralId);
    }
  }

  private ensureCentralPeer(centralId: string): void {
    if (!this.opts || this.centralIds.has(centralId)) return;
    this.centralIds.add(centralId);
    this.opts.onPeer({
      id: centralId,
      write: async (frame) => {
        await BleManager.setCharacteristicValue(
          GHOSTWIRE_SERVICE_UUID,
          GHOSTWIRE_NOTIFY_CHAR_UUID,
          toBase64(frame),
          true,
          [centralId],
        );
      },
    });
  }

  async stop(): Promise<void> {
    try {
      await BleManager.stopScan();
      await BleManager.stopAdvertising();
      await BleManager.unpublishServices();
    } catch {
      /* ignore */
    }
    this.connections.clear();
    this.centralIds.clear();
    this.started = false;
  }

  get isStarted(): boolean {
    return this.started;
  }
}
