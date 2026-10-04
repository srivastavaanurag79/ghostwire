import type { Role } from "@ghostwire/protocol";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function shortHex(bytes: Uint8Array, chars = 4): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, chars)}…${hex.slice(-chars)}`;
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-2)}` : id;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface RoleMeta {
  label: string;
  dot: string;
  text: string;
  ring: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  admin: { label: "Admin", dot: "bg-tg-purple", text: "text-tg-purple", ring: "ring-tg-purple/40" },
  moderator: { label: "Moderator", dot: "bg-tg-blue", text: "text-tg-blue", ring: "ring-tg-blue/40" },
  speaker: { label: "Speaker", dot: "bg-tg-green", text: "text-tg-green", ring: "ring-tg-green/40" },
  listener: { label: "Listener", dot: "bg-slate-400", text: "text-slate-400", ring: "ring-slate-400/30" },
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Deterministic avatar hue from a public key, so a name always looks the same. */
export function avatarHue(pubkey: Uint8Array): number {
  let h = 0;
  for (const b of pubkey.slice(0, 8)) h = (h * 31 + b) % 360;
  return h;
}
