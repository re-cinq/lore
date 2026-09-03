import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError, rethrowBoom } from "../api-error.js";
// Conversation registry (ai-agent-subsystem#188): GET fetches the prior run's state archive for pod init, POST saves this run's state for a later run; bytes ride the existing ArchivePort, Postgres holds only the index.

import type { ServerRoute } from "@hapi/hapi";
import { errorMessage } from "@re-cinq/lore-shared";
import { conversations } from "../../../kernel/queues.js";
import { conversationArchive } from "../../../kernel/archives.js";
import { rawBytes } from "../raw-body.js";

/** Where a conversation's archive lives in the bucket. */
export const conversationArchiveKey = (conversationId: string): string =>
  `agent-conversations/${conversationId}.tgz`;

export const agentConversationSaveRoute: ServerRoute = {
  method: "POST",
  path: "/api/agent-conversations/{id}",
  options: { auth: "internal-token", payload: { parse: false } },
  handler: async (request, h) => {
    const id = request.params.id;
    const archive = conversationArchive();

    // No bucket configured (laptop without GCS) is not an error — the next run just starts fresh.
    if (!archive) {
      return h.response({ status: "skipped", reason: "no archive" }).code(202);
    }
    // rawBytes, never rawBody: a utf-8 decode of gzip bytes corrupts them to a tar that won't extract in a pod.
    const body = rawBytes(request);
    const key = conversationArchiveKey(id);

    await archive.save(key, body, { contentType: "application/gzip" });
    // Reserved at dispatch: an unknown id means this pod was never told to save under it, so record nothing.
    const known = await conversations().attachArchive(id, key, body.length);

    if (!known) {
      console.warn(
        `[agent-conversations] archive for unreserved id ${id} (${body.length} bytes)`,
      );
    }

    return h
      .response({ status: "ok", bytes: body.length, indexed: known })
      .code(200);
  },
};

export const agentConversationFetchRoute: ServerRoute = {
  method: "GET",
  path: "/api/agent-conversations/{id}",
  options: { auth: "internal-token" },
  handler: async (request, h) => {
    try {
      const record = await conversations().byConversationId(request.params.id);
      const archive = conversationArchive();

      enforceTrue(record?.objectKey && archive, apiError(404), "not found");
      const bytes = await archive.readBytes(record.objectKey);

      enforceTrue(bytes, apiError(404), "not found");

      return h.response(Buffer.from(bytes)).type("application/gzip").code(200);
    } catch (err) {
      // A guard above already answered 404 deliberately; only an unexpected failure reaches here.
      rethrowBoom(err);

      // A failed restore must never fail the RUN — the pod's fetch is best-effort and degrades to a fresh conversation.
      console.warn(`[agent-conversations] fetch failed: ${errorMessage(err)}`);

      return h.response({ error: "not found" }).code(404);
    }
  },
};
