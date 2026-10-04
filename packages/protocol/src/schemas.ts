import { z } from "zod";
import { MESSAGE_TYPES } from "./types";

const bytes = z.instanceof(Uint8Array);

export const roleSchema = z.enum(["admin", "moderator", "speaker", "listener"]);

export const roleTokenSchema = z.object({
  v: z.literal(1),
  sid: z.string().min(1),
  name: z.string().min(1).max(64),
  pubkey: bytes,
  role: roleSchema,
  expiry: z.number().int(),
  issuer: bytes,
  signature: bytes,
});

export const delegationCertSchema = z.object({
  v: z.literal(1),
  sid: z.string().min(1),
  subjectPubkey: bytes,
  issuerPubkey: bytes,
  permissions: z.array(z.enum(["approve", "revoke"])),
  expiry: z.number().int(),
  signature: bytes,
});

export const senderInfoSchema = z.object({
  name: z.string().min(1).max(64),
  pubkey: bytes,
  role: roleSchema,
  token: roleTokenSchema,
});

export const envelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  ts: z.number().int(),
  epoch: z.number().int().nonnegative(),
  ttl: z.number().int(),
  hops: z.number().int().nonnegative(),
  nonce: bytes,
  ciphertext: bytes,
  signature: bytes,
});

export const innerMessageSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  type: z.enum(MESSAGE_TYPES as unknown as [string, ...string[]]),
  ts: z.number().int(),
  sender: senderInfoSchema,
  body: z.unknown(),
});

export type EnvelopeInput = z.infer<typeof envelopeSchema>;
export type InnerMessageInput = z.infer<typeof innerMessageSchema>;
export type RoleTokenInput = z.infer<typeof roleTokenSchema>;
export type DelegationCertInput = z.infer<typeof delegationCertSchema>;
