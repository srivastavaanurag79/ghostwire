import type { RelayRoomConfig } from "@ghostwire/transport";

/**
 * On-phone relay (work in progress).
 *
 * Lets the host phone be the "server" with no computer: it listens on the local
 * network / hotspot and speaks the same room protocol as `apps/relay`, so other
 * phones join with a 6-digit PIN exactly like the web relay.
 *
 * A Node `ws` server cannot run in React Native, so this uses a TCP socket
 * module (`react-native-tcp-socket`) plus a minimal WebSocket handshake and the
 * GhostWire room framing (0x00 broadcast / 0x01 directed, control JSON).
 *
 * Status: interface + plan. The WebSocket handshake/framing needs the native TCP
 * module and a development build; wiring is stubbed below.
 */
export interface LocalRelayHandle {
  port: number;
  pin: string;
  close(): Promise<void>;
}

export interface LocalRelayOptions {
  port?: number;
  /** Session bootstrap handed to joiners (same shape as the web relay). */
  config: RelayRoomConfig;
  /** Called with the PIN once listening. */
  onReady?: (handle: { port: number; pin: string }) => void;
}

export async function startLocalRelay(options: LocalRelayOptions): Promise<LocalRelayHandle> {
  void options;
  // TODO(native): accept TCP connections with react-native-tcp-socket, perform the
  // RFC 6455 handshake, then reuse the room framing from apps/relay:
  //   - client -> server: 0x00 || payload | 0x01 || targetLen || target || payload
  //   - server -> client: senderLen || senderId || payload, plus welcome/join/leave
  // Keep the same PIN/config flow so web and native peers interoperate.
  throw new Error(
    "On-phone relay needs a development build with react-native-tcp-socket (planned).",
  );
}
