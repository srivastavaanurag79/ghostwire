import { create } from "zustand";
import type { ChatMessage, Peer, Role } from "@ghostwire/protocol";

export type TransportKind = "webrtc" | "relay";

export type NotificationKind = "join" | "leave" | "request" | "message" | "success" | "error";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  ts: number;
  read: boolean;
}

export interface JoinRequestView {
  peerId: string;
  name: string;
  pubkey: Uint8Array;
  requestedRole: Role;
  receivedAt: number;
}

export interface TransferView {
  id: string;
  name: string;
  size: number;
  mime: string;
  direction: "in" | "out";
  progress: number;
  status: "active" | "done" | "error";
  url?: string;
}

interface UiState {
  status: "idle" | "active";
  joined: boolean;
  role: Role | null;
  sessionId: string | null;
  myName: string;
  isHost: boolean;
  transportKind: TransportKind | null;
  peers: Peer[];
  messages: ChatMessage[];
  joinRequests: JoinRequestView[];
  transfers: TransferView[];
  notifications: AppNotification[];
  soundEnabled: boolean;
  connection: "online" | "offline";
  notice: string | null;

  activate: (data: {
    role: Role;
    sessionId: string;
    myName: string;
    isHost: boolean;
    transportKind: TransportKind;
    joined?: boolean;
  }) => void;
  setJoined: (joined: boolean) => void;
  setRole: (role: Role) => void;
  setPeers: (peers: Peer[]) => void;
  addMessage: (message: ChatMessage) => void;
  addJoinRequest: (request: JoinRequestView) => void;
  removeJoinRequest: (peerId: string) => void;
  addTransfer: (transfer: TransferView) => void;
  updateTransfer: (id: string, patch: Partial<TransferView>) => void;
  addNotification: (notification: AppNotification) => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setConnection: (connection: "online" | "offline") => void;
  setNotice: (notice: string | null) => void;
  reset: () => void;
}

const initial = {
  status: "idle" as const,
  joined: false,
  role: null,
  sessionId: null,
  myName: "",
  isHost: false,
  transportKind: null,
  peers: [] as Peer[],
  messages: [] as ChatMessage[],
  joinRequests: [] as JoinRequestView[],
  transfers: [] as TransferView[],
  notifications: [] as AppNotification[],
  soundEnabled: true,
  connection: "online" as const,
  notice: null as string | null,
};

export const useUi = create<UiState>((set) => ({
  ...initial,
  activate: (data) =>
    set({
      role: data.role,
      sessionId: data.sessionId,
      myName: data.myName,
      isHost: data.isHost,
      transportKind: data.transportKind,
      joined: data.joined ?? false,
      status: "active",
    }),
  setJoined: (joined) => set({ joined }),
  setRole: (role) => set({ role }),
  setPeers: (peers) => set({ peers }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  addJoinRequest: (request) =>
    set((s) => ({
      joinRequests: s.joinRequests.some((r) => r.peerId === request.peerId)
        ? s.joinRequests
        : [...s.joinRequests, request],
    })),
  removeJoinRequest: (peerId) =>
    set((s) => ({ joinRequests: s.joinRequests.filter((r) => r.peerId !== peerId) })),
  addTransfer: (transfer) => set((s) => ({ transfers: [transfer, ...s.transfers] })),
  updateTransfer: (id, patch) =>
    set((s) => ({
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  addNotification: (notification) =>
    set((s) => ({
      // Keep the list bounded; newest first.
      notifications: [notification, ...s.notifications].slice(0, 100),
    })),
  markNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
  clearNotifications: () => set({ notifications: [] }),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setConnection: (connection) => set({ connection }),
  setNotice: (notice) => set({ notice }),
  reset: () => set({ ...initial }),
}));

export function systemMessage(content: string, name = "system"): ChatMessage {
  return {
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    name,
    pubkey: new Uint8Array(0),
    role: "listener",
    content,
    isSystem: true,
  };
}
