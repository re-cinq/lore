// The live socket's wire protocol as the browser speaks it (ADR-048): JSON text frames, a client-chosen channel id on each, typed from lore-api's published contract so there is no hand mirror to drift.
import type { components } from "@/lib/api/schema";
import { record, str } from "@/lib/json-field";

export type LiveClientMessage = components["schemas"]["LiveClientMessage"];
export type LiveServerMessage = components["schemas"]["LiveServerMessage"];
export type ClosedReason = Extract<
  LiveServerMessage,
  { type: "closed" }
>["reason"];

export type ChannelKind = "run" | "plan";

const SERVER_TYPES: ReadonlySet<string> = new Set<LiveServerMessage["type"]>([
  "opened",
  "frame",
  "data",
  "closed",
  "error",
]);

/** A server message, or null for non-JSON, an unknown type, or a message without the channel its type needs; one bad frame never takes the socket down. */
export function decodeServerMessage(text: string): LiveServerMessage | null {
  try {
    const body = record(JSON.parse(text));
    const type = str(body.type);

    if (type === null || !SERVER_TYPES.has(type)) {
      return null;
    }

    if (type !== "error" && str(body.channel) === null) {
      return null;
    }

    return body as unknown as LiveServerMessage;
  } catch {
    return null;
  }
}

export function encodeClientMessage(message: LiveClientMessage): string {
  return JSON.stringify(message);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
