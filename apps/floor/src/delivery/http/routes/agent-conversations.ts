// The conversation registry a run pod talks to (ai-agent-subsystem#188).
//
// GET  /api/agent-conversations/{id} — the prior run's state archive, which the pod's
//      init extracts before the agent starts.
// POST /api/agent-conversations/{id} — this run's own state, saved so a LATER run can
//      continue it.
//
// The bytes go through the ArchivePort that already archives raw run streams, so
// there is no second blob store and no new retention mechanism; Postgres holds only
// the index. Auth is `internal-token`, the same kind the pod already uses for
// /api/agent-events, so the pod needs no new credential.

import type { ServerRoute } from "@hapi/hapi";
import { errorMessage } from "@re-cinq/lore-shared";
import { conversations } from "../../../kernel/queues.js";
import { agentEventsArchive } from "../../../kernel/archives.js";
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
    const archive = agentEventsArchive();

    // No bucket configured (a laptop without GCS) is not an error: the run still
    // succeeded, and the only cost is that the NEXT run starts fresh.
    if (!archive) {
      return h.response({ status: "skipped", reason: "no archive" }).code(202);
    }
    // rawBytes, never rawBody: a gzip archive through a utf-8 decode loses every
    // byte above 0x7F to U+FFFD, and the corruption only surfaces later as a tar
    // that will not extract inside a pod.
    const body = rawBytes(request);
    const key = conversationArchiveKey(id);

    await archive.save(key, body, { contentType: "application/gzip" });
    // Reserved at dispatch, so an unknown id means this pod was never told to save
    // under it — record nothing rather than inventing a row nothing can resolve.
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
      const archive = agentEventsArchive();

      if (!record?.objectKey || !archive) {
        return h.response({ error: "not found" }).code(404);
      }
      const bytes = await archive.readBytes(record.objectKey);

      if (!bytes) {
        return h.response({ error: "not found" }).code(404);
      }

      return h.response(Buffer.from(bytes)).type("application/gzip").code(200);
    } catch (err) {
      // A failed restore must never fail the RUN — the pod's fetch is best-effort and
      // degrades to a fresh conversation, so answering 404 keeps that path honest.
      console.warn(`[agent-conversations] fetch failed: ${errorMessage(err)}`);

      return h.response({ error: "not found" }).code(404);
    }
  },
};
