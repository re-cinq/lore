import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createHash } from "node:crypto";
import { z } from "zod";
import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { makeGraphLlmCall } from "../helpers.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

const SessionSummaryBody = z.object({
  session_log: z.union([
    z.string().min(1),
    z.object({ summary: z.string().optional() }).passthrough(),
  ]),
  repo: z.string().optional(),
  agent_id: z.string().optional(),
});

type SessionSummaryBody = z.infer<typeof SessionSummaryBody>;

/** A session summary is ingested, skipped as empty, or recognised as a duplicate. */
const SessionSummarySchema = z.union([
  z.object({ status: z.literal("ok"), episode_id: z.string() }),
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({ status: z.literal("duplicate") }),
]);

function summaryText(sessionLog: SessionSummaryBody["session_log"]): string {
  if (typeof sessionLog === "string") {
    return sessionLog;
  }

  return sessionLog.summary || JSON.stringify(sessionLog);
}

function isEmptySummary(summary: string): boolean {
  return !summary || summary.length < 10;
}

function sessionContent(repo: string | undefined, summary: string): string {
  return `Session in ${repo || "unknown"}\n\n${summary}`;
}

async function insertSessionEpisode(
  pool: Pool,
  fields: {
    agent: string;
    content: string;
    contentHash: string;
    repo: string | null;
  },
) {
  const { rows } = await pool.query(
    `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
     VALUES ($1, $2, $3, 'session', $4)
     ON CONFLICT (agent_id, content_hash) DO NOTHING
     RETURNING id`,
    [fields.agent, fields.content, fields.contentHash, fields.repo],
  );

  return rows[0]?.id as string | undefined;
}

interface SessionExtractionFields {
  episodeId: string;
  content: string;
  agent: string;
  repo: string | null;
}

function scheduleSessionExtraction(
  pool: Pool,
  fields: SessionExtractionFields,
) {
  const { episodeId, content, agent, repo } = fields;

  extractFactsFromEpisode(episodeId, content, agent, pool).catch(() => {});
  const gLlm = makeGraphLlmCall(pool);

  if (!gLlm) {
    return;
  }

  extractAndUpdateGraph(
    pool,
    content,
    { repo, sourceEpisodeId: episodeId, sourceMemoryId: null },
    gLlm,
  ).catch(() => {});
}

export function sessionSummaryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/session-summary",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(SessionSummaryBody) },
      },
      SessionSummarySchema,
      {
        name: "SessionSummaryResult",
        description: "What became of the posted session",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      try {
        const { session_log, repo, agent_id } =
          request.payload as SessionSummaryBody;
        const summary = summaryText(session_log);

        if (isEmptySummary(summary)) {
          return h.response({ status: "skipped", reason: "empty session" });
        }

        const content = sessionContent(repo, summary);
        const agent = agent_id || "session-hook";
        const scopedRepo = repo || null;
        const contentHash = createHash("sha256").update(content).digest("hex");

        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        const episodeId = await insertSessionEpisode(pool, {
          agent,
          content,
          contentHash,
          repo: scopedRepo,
        });

        if (episodeId === undefined) {
          return h.response({ status: "duplicate" });
        }

        scheduleSessionExtraction(pool, {
          episodeId,
          content,
          agent,
          repo: scopedRepo,
        });

        return h.response({ status: "ok", episode_id: episodeId });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
