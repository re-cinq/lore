// The stations' door to lore-api's session-summary route, which stores an episode in agent memory and extracts its facts.
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { bearerJsonHeaders } from "@re-cinq/lore-shared/project/lib/http-auth.js";

const TIMEOUT_MS = 30_000;

export interface SessionSummary {
  repo: string;
  agentId: string;
  content: string;
}

export async function postSessionSummary(
  summary: SessionSummary,
): Promise<void> {
  const baseUrl = process.env.LORE_API_URL;

  enforceTrue(baseUrl, Error, "no LORE_API_URL configured");
  const res = await fetch(`${baseUrl}/api/session-summary`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: bearerJsonHeaders(
      process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN,
    ),
    body: JSON.stringify({
      session_log: summary.content,
      repo: summary.repo,
      agent_id: summary.agentId,
    }),
  });

  enforceTrue(res.ok, Error, `POST /api/session-summary failed: ${res.status}`);
}
