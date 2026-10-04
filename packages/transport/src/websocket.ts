import { BaseTransport, type SignalingData } from "./types";

/**
 * WebSocket relay transport.
 *
 * Used for the "host spot" mode: the admin device (native) runs a tiny relay
 * on the local network or hotspot, and every peer opens a WebSocket to it. It
 * also lets a self-hosted relay bridge peers that cannot reach each other
 * directly. The relay only forwards opaque bytes — it can never read content.
 *
 * Wire framing (client -> server):
 *   broadcast : 0x00 || payload
 *   directed  : 0x01 || targetLen(1) || targetId || payload
 * (server -> client):
 *   binary    : senderLen(1) || senderId || payload
 *   text      : JSON control frame (welcome / join / leave)
 */
const FRAME_BROADCAST = 0x00;
const FRAME_DIRECTED = 0x01;
const MAX_ID_BYTES = 255;

export interface WebSocketTransportOptions {
  /** Auto-reconnect with backoff. Defaults to true. */
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
}

export class WebSocketTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  private selfId: string | null = null;
  private readonly peers = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly options: WebSocketTransportOptions = {},
  ) {
    super();
  }

  get peerIds(): readonly string[] {
    return [...this.peers];
  }

  /** The relay-assigned id for this client (available after `open`). */
  get id(): string | null {
    return this.selfId;
  }

  /** The relay URL this transport is connected to. */
  get relayUrl(): string {
    return this.url;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(_peerId: string, _signaling?: SignalingData): Promise<void> {
    return this.open();
  }

  open(): Promise<void> {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return Promise.resolve();
    this.closed = false;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`WebSocketTransport: cannot connect to ${this.url}`));
      socket.onclose = () => {
        this.handleClose();
        this.scheduleReconnect();
      };
      socket.onmessage = (event) => this.handleFrame(event.data);
    });
  }

  send(peerId: string, data: Uint8Array): void {
    const target = new TextEncoder().encode(peerId);
    if (target.length > MAX_ID_BYTES) throw new Error("send: peerId too long");
    const frame = new Uint8Array(2 + target.length + data.length);
    frame[0] = FRAME_DIRECTED;
    frame[1] = target.length;
    frame.set(target, 2);
    frame.set(data, 2 + target.length);
    this.rawSend(frame);
  }

  broadcast(data: Uint8Array, _exceptPeerId?: string): void {
    const frame = new Uint8Array(1 + data.length);
    frame[0] = FRAME_BROADCAST;
    frame.set(data, 1);
    this.rawSend(frame);
  }

  close(peerId?: string): void {
    if (peerId) {
      this.peers.delete(peerId);
      return;
    }
    this.closed = true;
    this.clearReconnect();
    this.socket?.close();
    this.socket = null;
    for (const id of [...this.peers]) this.peers.delete(id);
  }

  private rawSend(frame: Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(frame);
  }

  private handleFrame(raw: unknown): void {
    if (typeof raw === "string") {
      this.handleControl(raw);
      return;
    }
    let bytes: Uint8Array;
    if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else if (ArrayBuffer.isView(raw)) {
      bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else return;
    if (bytes.length < 1) return;
    const senderLen = bytes[0]!;
    if (bytes.length < 1 + senderLen) return;
    const sender = new TextDecoder().decode(bytes.subarray(1, 1 + senderLen));
    const payload = bytes.subarray(1 + senderLen);
    if (sender) this.emitMessage(sender, payload);
  }

  private handleControl(text: string): void {
    try {
      const msg = JSON.parse(text) as { t?: string; id?: string };
      if (msg.t === "welcome" && msg.id) {
        this.selfId = msg.id;
      } else if (msg.t === "join" && msg.id) {
        this.peers.add(msg.id);
        this.emitJoin(msg.id);
      } else if (msg.t === "leave" && msg.id) {
        this.peers.delete(msg.id);
        this.emitLeave(msg.id);
      }
    } catch {
      /* ignore malformed control frames */
    }
  }

  private handleClose(): void {
    const known = [...this.peers];
    this.peers.clear();
    for (const id of known) this.emitLeave(id);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.options.autoReconnect === false) return;
    if (this.reconnectTimer) return;
    const delay = this.options.reconnectDelayMs ?? 2_000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
