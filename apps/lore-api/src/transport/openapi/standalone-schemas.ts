// Schemas the document publishes without a route to hang them on: the live socket's frames and envelopes (ADR-048) travel over /api/ws, not HTTP, yet the web-ui reads them as generated types exactly like a response body.

import type { ZodType } from "zod";
import {
  LIVE_SOCKET_PATH,
  LiveClientMessageSchema,
  LiveServerMessageSchema,
} from "../../work/assembly-line-station/protocol.js";
import { RunStreamFrameSchema } from "../../work/assembly-line-station/run-stream-frame.js";

export const STANDALONE_SCHEMAS: Record<string, ZodType> = {
  RunStreamFrame: RunStreamFrameSchema,
  LiveClientMessage: LiveClientMessageSchema,
  LiveServerMessage: LiveServerMessageSchema,
};

/** The root extension that says where the socket is and what crosses it, since OpenAPI paths only describe HTTP. */
export const WEBSOCKET_EXTENSION = {
  path: LIVE_SOCKET_PATH,
  description:
    "The browser's one live socket: JSON text frames, client-chosen channel ids; a `run` channel carries RunStreamFrame envelopes, a `plan` channel tunnels the plan collaboration protocol as base64.",
  client: { $ref: "#/components/schemas/LiveClientMessage" },
  server: { $ref: "#/components/schemas/LiveServerMessage" },
};
