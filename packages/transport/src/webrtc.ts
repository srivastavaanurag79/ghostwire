import { BaseTransport, type SignalingData, type WebRTCTransport } from "./types";

interface Connection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  joined: boolean;
}

export interface BrowserWebRTCTransportOptions {
  /**
   * ICE servers. Defaults to none: with an empty list the browser only uses
   * host candidates, so connections stay on the local network and never touch
   * a third-party STUN/TURN server. That is what makes it work offline and
   * leak no metadata to the internet.
   */
  iceServers?: RTCIceServer[];
  /** How long to wait for ICE gathering before snapshotting the SDP. */
  gatherTimeoutMs?: number;
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * `RTCDataChannel.send` types only accept `ArrayBufferView<ArrayBuffer>`.
 * A Uint8Array produced at runtime may be typed over `ArrayBufferLike`; the
 * cast is safe because we always pass a plain byte array.
 */
function sendBinary(dc: RTCDataChannel, data: Uint8Array): void {
  dc.send(data as unknown as ArrayBufferView<ArrayBuffer>);
}

/**
 * Browser WebRTC DataChannel transport with QR-friendly, non-trickle ICE.
 *
 * The admin device acts as the hub (the "server" of the session): it creates
 * offers, peers answer, and every link is a direct peer-to-peer data channel.
 * Links can also be created between arbitrary peers for a partial mesh.
 */
export class BrowserWebRTCTransport extends BaseTransport implements WebRTCTransport {
  private readonly connections = new Map<string, Connection>();
  private readonly iceServers: RTCIceServer[];
  private readonly gatherTimeoutMs: number;

  constructor(options: BrowserWebRTCTransportOptions = {}) {
    super();
    this.iceServers = options.iceServers ?? [];
    this.gatherTimeoutMs = options.gatherTimeoutMs ?? 4_000;
  }

  get peerIds(): readonly string[] {
    return [...this.connections.keys()];
  }

  async connect(peerId: string, signaling?: SignalingData): Promise<void> {
    if (!signaling) {
      if (!this.connections.has(peerId)) this.createConnection(peerId, true);
      return;
    }
    if (signaling.type === "offer") {
      await this.acceptOffer(signaling);
    } else {
      await this.acceptAnswer(peerId, signaling);
    }
  }

  async createOffer(
    peerId = randomId(),
  ): Promise<{ peerId: string; signaling: SignalingData }> {
    const conn = this.createConnection(peerId, true);
    const offer = await conn.pc.createOffer();
    await conn.pc.setLocalDescription(offer);
    await this.waitForIceGathering(conn.pc);
    const sdp = conn.pc.localDescription?.sdp ?? offer.sdp ?? "";
    return { peerId, signaling: { type: "offer", sdp, id: peerId } };
  }

  async acceptOffer(
    signaling: SignalingData,
  ): Promise<{ peerId: string; signaling: SignalingData }> {
    const peerId = signaling.id ?? randomId();
    const conn = this.createConnection(peerId, false);
    await conn.pc.setRemoteDescription({ type: "offer", sdp: signaling.sdp });
    const answer = await conn.pc.createAnswer();
    await conn.pc.setLocalDescription(answer);
    await this.waitForIceGathering(conn.pc);
    const sdp = conn.pc.localDescription?.sdp ?? answer.sdp ?? "";
    return { peerId, signaling: { type: "answer", sdp, id: peerId } };
  }

  async acceptAnswer(peerId: string, signaling: SignalingData): Promise<void> {
    const conn = this.connections.get(peerId);
    if (!conn) throw new Error(`acceptAnswer: no pending connection ${peerId}`);
    await conn.pc.setRemoteDescription({ type: "answer", sdp: signaling.sdp });
  }

  send(peerId: string, data: Uint8Array): void {
    const dc = this.connections.get(peerId)?.dc;
    if (dc && dc.readyState === "open") sendBinary(dc, data);
  }

  broadcast(data: Uint8Array, exceptPeerId?: string): void {
    for (const [id, conn] of this.connections) {
      if (id === exceptPeerId) continue;
      if (conn.dc && conn.dc.readyState === "open") sendBinary(conn.dc, data);
    }
  }

  close(peerId?: string): void {
    if (peerId) {
      const conn = this.connections.get(peerId);
      if (!conn) return;
      conn.dc?.close();
      conn.pc.close();
      this.connections.delete(peerId);
      this.emitLeave(peerId);
      return;
    }
    for (const id of [...this.connections.keys()]) this.close(id);
  }

  private createConnection(peerId: string, initiator: boolean): Connection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const conn: Connection = { pc, dc: null, joined: false };
    this.connections.set(peerId, conn);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.handleLeave(peerId);
      }
    };

    if (initiator) {
      const dc = pc.createDataChannel("ghostwire", { ordered: true });
      this.wireDataChannel(peerId, dc);
    } else {
      pc.ondatachannel = (event) => this.wireDataChannel(peerId, event.channel);
    }

    return conn;
  }

  private wireDataChannel(peerId: string, dc: RTCDataChannel): void {
    const conn = this.connections.get(peerId);
    if (conn) conn.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      if (conn && !conn.joined) {
        conn.joined = true;
        this.emitJoin(peerId);
      }
    };
    dc.onclose = () => this.handleLeave(peerId);
    dc.onerror = () => this.handleLeave(peerId);
    dc.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) this.emitMessage(peerId, new Uint8Array(data));
      else if (ArrayBuffer.isView(data)) {
        this.emitMessage(peerId, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      }
    };
  }

  private handleLeave(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (!conn) return;
    this.connections.delete(peerId);
    try {
      conn.pc.close();
    } catch {
      /* already closed */
    }
    if (conn.joined) this.emitLeave(peerId);
  }

  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      const timer = setTimeout(done, this.gatherTimeoutMs);
      pc.addEventListener("icegatheringstatechange", check);
    });
  }
}
