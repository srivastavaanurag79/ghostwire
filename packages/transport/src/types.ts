/**
 * Transport is the only platform-specific layer. Everything above it (protocol,
 * crypto, mesh) is identical on web and native.
 *
 * A transport moves opaque bytes between peers. It knows nothing about session
 * keys, roles or message types — that is deliberate, so a relay can never
 * inspect content.
 */

/** Non-trickle WebRTC signaling payload. `id` is the shared link id. */
export interface SignalingData {
  type: "offer" | "answer";
  sdp: string;
  id?: string;
}

export type Unsubscribe = () => void;

export interface Transport {
  /** Currently connected peer/link ids. */
  readonly peerIds: readonly string[];
  /** Establish (or adopt) a link to `peerId`. */
  connect(peerId: string, signaling?: SignalingData): Promise<void>;
  /** Send bytes to one peer. */
  send(peerId: string, data: Uint8Array): void;
  /** Send bytes to every peer, optionally excluding one (the sender). */
  broadcast(data: Uint8Array, exceptPeerId?: string): void;
  onMessage(cb: (peerId: string, data: Uint8Array) => void): Unsubscribe;
  onPeerJoin(cb: (peerId: string) => void): Unsubscribe;
  onPeerLeave(cb: (peerId: string) => void): Unsubscribe;
  /** Close one link, or the whole transport when called with no argument. */
  close(peerId?: string): void;
}

/**
 * A WebRTC transport additionally supports the QR bootstrap dance:
 * the offerer creates an offer, the joiner turns it into an answer, and the
 * offerer applies the answer. With non-trickle ICE a single QR each way is
 * enough — no signaling server.
 */
export interface WebRTCTransport extends Transport {
  createOffer(peerId?: string): Promise<{ peerId: string; signaling: SignalingData }>;
  acceptOffer(
    signaling: SignalingData,
  ): Promise<{ peerId: string; signaling: SignalingData }>;
  acceptAnswer(peerId: string, signaling: SignalingData): Promise<void>;
}

/** Base class with the event plumbing every transport needs. */
export abstract class BaseTransport implements Transport {
  protected readonly messageHandlers = new Set<
    (peerId: string, data: Uint8Array) => void
  >();
  protected readonly joinHandlers = new Set<(peerId: string) => void>();
  protected readonly leaveHandlers = new Set<(peerId: string) => void>();

  abstract readonly peerIds: readonly string[];
  abstract connect(peerId: string, signaling?: SignalingData): Promise<void>;
  abstract send(peerId: string, data: Uint8Array): void;
  abstract broadcast(data: Uint8Array, exceptPeerId?: string): void;
  abstract close(peerId?: string): void;

  onMessage(cb: (peerId: string, data: Uint8Array) => void): Unsubscribe {
    this.messageHandlers.add(cb);
    return () => this.messageHandlers.delete(cb);
  }

  onPeerJoin(cb: (peerId: string) => void): Unsubscribe {
    this.joinHandlers.add(cb);
    return () => this.joinHandlers.delete(cb);
  }

  onPeerLeave(cb: (peerId: string) => void): Unsubscribe {
    this.leaveHandlers.add(cb);
    return () => this.leaveHandlers.delete(cb);
  }

  protected emitMessage(peerId: string, data: Uint8Array): void {
    for (const handler of this.messageHandlers) handler(peerId, data);
  }

  protected emitJoin(peerId: string): void {
    for (const handler of this.joinHandlers) handler(peerId);
  }

  protected emitLeave(peerId: string): void {
    for (const handler of this.leaveHandlers) handler(peerId);
  }
}
