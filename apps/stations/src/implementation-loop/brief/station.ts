// The implementation loop's briefing (specs/implementation-loop FR21): before the definition-of-done pod, lore-api's context builder (backend lore-v2) is asked once for the ticket's briefing, which the floor keeps as the `brief` file every later agent of the run reads. A briefing that cannot be built never holds the run: the agents fall back to asking for context themselves.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { bearerJsonHeaders } from "@re-cinq/lore-shared/project/lib/http-auth.js";

export interface BriefDeps {
  /** The briefing lore-api built for the ticket, or null when it built none. */
  build(repo: string, ticket: string): Promise<string | null>;
}

/** The builder takes 40-70 s on a ticket (11-05 evals) and the MCP tool allows 120 s; this leaves room for the fallback assembly behind it. */
const TIMEOUT_MS = 150_000;
const BRIEF_BUDGET_TOKENS = 8000;

const GO_ON = { outcome: "success" } as const;

export const productionBriefDeps: BriefDeps = {
  build: async (repo, ticket) => {
    const res = await postContext({
      repo,
      query: ticket,
      backend: "lore-v2",
      template: "implementation",
      max_tokens: BRIEF_BUDGET_TOKENS,
    });

    enforceTrue(res.ok, Error, `POST /api/context failed: ${res.status}`);
    const { text } = (await res.json()) as { text?: string | null };

    return text?.trim() || null;
  },
};

function postContext(body: Record<string, unknown>): Promise<Response> {
  const baseUrl = process.env.LORE_API_URL;

  enforceTrue(baseUrl, Error, "no LORE_API_URL configured");

  return fetch(`${baseUrl}/api/context`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: bearerJsonHeaders(
      process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN,
    ),
    body: JSON.stringify(body),
  });
}

export function briefHandle(deps: BriefDeps): Handle {
  return async ({ needs }, tools) => {
    const { repo } = parseGitRef(needs.target);

    try {
      const ticket = (await tools.read("ticket")).toString("utf8");
      const brief = await deps.build(repo, ticket);

      if (brief) {
        await tools.produce("brief", Buffer.from(brief, "utf8"));
      }
    } catch (err) {
      console.warn(`[loop-brief] ${repo}: ${errorMessage(err)}`);
    }

    return GO_ON;
  };
}

export function startBriefStation(): RunningStation {
  return defineStation("loop-brief", briefHandle(productionBriefDeps));
}
