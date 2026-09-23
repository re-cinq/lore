// The live socket's wire protocol (ADR-048): one JSON text frame per message, a client-chosen channel id on every one, so one connection carries a run's frames and a plan's tunnelled bytes side by side. Published in OpenAPI as `LiveClientMessage` / `LiveServerMessage` so the web-ui reads both as generated types.

import { z } from "zod";
import { RunStreamFrameSchema } from "./run-stream-frame.js";

export const LIVE_SOCKET_PATH = "/api/ws";

/** Channels one socket may hold at once; a page needs one or two. */
export const MAX_CHANNELS_PER_SOCKET = 8;

const Channel = z.string().min(1).max(64);

/** Base64 of the tunnelled bytes; JSON has no binary. */
const Bytes = z.string();

// A plain union: two `open` shapes share the discriminator and differ on `kind`.
export const LiveClientMessageSchema = z.union([
  z.object({
    type: z.literal("open"),
    channel: Channel,
    kind: z.literal("run"),
    subject: z.string().min(1),
    token: z.string().min(1),
    after: z.string().regex(/^\d+$/).optional(),
  }),
  z.object({
    type: z.literal("open"),
    channel: Channel,
    kind: z.literal("plan"),
    subject: z.string().min(1),
  }),
  z.object({ type: z.literal("send"), channel: Channel, data: Bytes }),
  z.object({ type: z.literal("close"), channel: Channel }),
]);

export const ClosedReasonSchema = z.enum([
  "client",
  "unauthorized",
  "not_found",
  "capacity",
  "slow",
  "server",
]);

export const LiveErrorCodeSchema = z.enum([
  "bad_message",
  "channel_in_use",
  "too_many_channels",
  "unknown_channel",
]);

export const LiveServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("opened"), channel: Channel }),
  z.object({
    type: z.literal("frame"),
    channel: Channel,
    frame: RunStreamFrameSchema,
  }),
  z.object({ type: z.literal("data"), channel: Channel, data: Bytes }),
  z.object({
    type: z.literal("closed"),
    channel: Channel,
    reason: ClosedReasonSchema,
    code: z.number().optional(),
  }),
  z.object({
    type: z.literal("error"),
    channel: Channel.optional(),
    code: LiveErrorCodeSchema,
  }),
]);

export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;
export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;
export type OpenMessage = Extract<LiveClientMessage, { type: "open" }>;
export type ClosedReason = z.infer<typeof ClosedReasonSchema>;
export type LiveErrorCode = z.infer<typeof LiveErrorCodeSchema>;

/** A client message, or null for anything that is not one: non-JSON, an unknown type, a missing field. */
export function parseClientMessage(text: string): LiveClientMessage | null {
  try {
    const parsed = LiveClientMessageSchema.safeParse(JSON.parse(text));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeServerMessage(message: LiveServerMessage): string {
  return JSON.stringify(message);
}

export const bytesToBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

export const base64ToBytes = (encoded: string): Uint8Array =>
  new Uint8Array(Buffer.from(encoded, "base64"));
