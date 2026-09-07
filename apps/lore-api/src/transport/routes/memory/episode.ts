import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { createHash } from "node:crypto";
import { z } from "zod";
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { makeGraphLlmCall } from "../helpers.js";

const EpisodeBody = z.object({
  content: z.string().min(1, "content required"),
  source: z.string().optional(),
  ref: z.string().optional(),
  agent_id: z.string().optional(),
});

type EpisodeBody = z.infer<typeof EpisodeBody>;

/** An episode is stored, or recognised as one already held. */
const EpisodeWrittenSchema = z.union([
  z.object({ status: z.literal("ok"), episode_id: z.string() }),
  z.object({ status: z.literal("duplicate") }),
]);

async function insertEpisode(
  pool: Pool,
  fields: {
    agent: string;
    safeContent: string;
    contentHash: string;
    source: string;
    ref: string | null;
  },
) {
  const { rows } = await pool.query(
    `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (agent_id, content_hash) DO NOTHING
     RETURNING id`,
    [
      fields.agent,
      fields.safeContent,
      fields.contentHash,
      fields.source,
      fields.ref,
    ],
  );

  return rows[0]?.id as string | undefined;
}

interface BackgroundExtractionFields {
  episodeId: string;
  safeContent: string;
  agent: string;
  ref: string | null;
}

function scheduleBackgroundExtraction(
  pool: Pool,
  fields: BackgroundExtractionFields,
) {
  const { episodeId, safeContent, agent, ref } = fields;

  extractFactsFromEpisode(episodeId, safeContent, agent, pool).catch(() => {});
  const gLlm = makeGraphLlmCall(pool);

  if (!gLlm) {
    return;
  }

  extractAndUpdateGraph(
    pool,
    safeContent,
    { repo: ref, sourceEpisodeId: episodeId, sourceMemoryId: null },
    gLlm,
  ).catch(() => {});
}

/** Ingests an episode and reports whether it was NEW: the writer is idempotent on content, so a re-posted conversation turn does not re-extract its facts. */
/** Stores one episode and starts its fact extraction. Content is SANITIZED before it is hashed or stored — this table is org-wide, and a secret in a conversation turn would otherwise be readable by every agent. The hash is what makes a re-posted turn a duplicate rather than a second episode, and extraction is scheduled only for a genuinely new one. */
async function writeEpisode(pool: Pool, body: EpisodeBody) {
  const { content, source, ref, agent_id } = body;
  const agent = agent_id || "unknown";
  const safeContent = sanitizeContent(content);
  const scopedRef = ref || null;
  const episodeId = await insertEpisode(pool, {
    agent,
    safeContent,
    contentHash: createHash("sha256").update(safeContent).digest("hex"),
    source: source || "session",
    ref: scopedRef,
  });

  if (episodeId === undefined) {
    return { status: "duplicate" };
  }

  scheduleBackgroundExtraction(pool, {
    episodeId,
    safeContent,
    agent,
    ref: scopedRef,
  });

  return { status: "ok", episode_id: episodeId };
}

async function serveEpisodeWrite(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  try {
    const written = await writeEpisode(pool!, request.payload as EpisodeBody);

    return h.response(written);
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}

export function episodeRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/episode",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(EpisodeBody) },
      },
      EpisodeWrittenSchema,
      { name: "EpisodeWritten", description: "Whether the episode was new" },
    ),
    handler: (request, h) => serveEpisodeWrite(getPool, request, h),
  };
}
