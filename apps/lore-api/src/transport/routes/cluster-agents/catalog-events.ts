import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import type {
  CatalogEvent,
  CatalogEventsRepository,
} from "@re-cinq/lore-shared/project/agents/catalog-events-port.js";
import { PgCatalogEvents } from "@re-cinq/lore-shared/project/agents/catalog-events-pg.js";
import { resolveCatalogEntry } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import { AgentDefsYaml } from "@re-cinq/lore-shared/project/agents/agent-defs-yaml.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";
import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";
import { zodResponse } from "../../http/zod-response.js";
import { withPool } from "../with-pool.js";
import { authenticateClusterAgent } from "./cluster-agent-auth.js";

// A cluster-agent pulls unapplied catalog changes (fan-out sibling of claim, each agent tailing lore.catalog_events with its own cursor); delivery is AT-LEAST-ONCE, advanced only by `ack` (CRD apply is idempotent so a re-delivered replay is a no-op), and a null cursor answers with the full snapshot as the fresh-cluster bootstrap.

const TAIL_BATCH = 200;

const CatalogEntrySchema = z.object({
  name: z.string(),
  project_id: z.string().nullable(),
  definition: ResolvedAgentDefinitionSchema.nullable(),
});

const CatalogEventsResponse = z.object({
  mode: z.enum(["snapshot", "tail"]),
  /** What to ack once every entry in this response is applied. */
  cursor: z.string(),
  entries: z.array(CatalogEntrySchema),
});

export interface CatalogEventsDeps {
  agents: ClusterAgentsRepository;
  events: CatalogEventsRepository;
  resolveEntry(
    name: string,
    projectId: string | null,
  ): Promise<ResolvedAgentDefinition | null>;
}

// Injectable handler core: authenticate, ack, snapshot-or-tail. `snapshot` forces a full-catalog boot resync (the cursor only tracks row content, not the agent binary's rendering) — safe since every entry resolves to the CURRENT row, superseding any skipped pending-tail events.
/** Where the agent's tail stands: the cursor it acknowledges, and whether it wants the full snapshot regardless. */
export interface CatalogCursor {
  ack?: string;
  snapshot?: boolean;
}

export function clusterAgentCatalogEventsRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster-agents/{id}/catalog-events",
    options: zodResponse(
      {
        auth: false,
      },
      CatalogEventsResponse,
      {
        name: "ClusterAgentCatalogEvents",
        description:
          "The catalog changes this cluster-agent has not applied yet — a full snapshot on first contact, an event tail after — each entry carrying the resolved definition to render, or null to delete",
      },
    ),
    handler: withPool(getPool, serveCatalogEvents),
  };
}

/** The catalog changes a cluster-agent has not applied yet, from its cursor — the pull side of catalog sync, since nothing is pushed to a cluster. */
async function serveCatalogEvents(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleCatalogEvents(
    catalogEventsDeps(pool),
    extractBearer(request.headers.authorization),
    request.params.id,
    requestedCursor(request),
  );

  return h.response(result.body).code(result.code);
}

/** The live repositories the route reads through, with catalog entries resolved against the YAML fallback. */
function catalogEventsDeps(pool: Pool): CatalogEventsDeps {
  const yaml = new AgentDefsYaml();

  return {
    agents: new PgClusterAgents(pool),
    events: new PgCatalogEvents(pool),
    resolveEntry: (name, projectId) =>
      resolveCatalogEntry(pool, yaml, name, projectId),
  };
}

/** A non-numeric `ack` is dropped rather than refused: an unparseable cursor must never advance one. */
function requestedCursor(request: Request): CatalogCursor {
  const ackRaw = request.query.ack;

  return {
    ack:
      typeof ackRaw === "string" && /^\d+$/.test(ackRaw) ? ackRaw : undefined,
    snapshot: request.query.snapshot === "1",
  };
}

export async function handleCatalogEvents(
  deps: CatalogEventsDeps,
  bearer: string | undefined,
  agentId: string,
  { ack, snapshot = false }: CatalogCursor = {},
): Promise<
  | { code: 200; body: z.infer<typeof CatalogEventsResponse> }
  | { code: 401 | 403 | 503; body: { error: string } }
> {
  const auth = await authenticateClusterAgent(deps.agents, bearer, agentId);

  if ("code" in auth) {
    return auth;
  }
  const cursor = await resolveCursor(deps, auth.agent, ack);

  if (snapshot || !hasCursor(cursor)) {
    return buildSnapshotResponse(deps, cursor);
  }

  return buildTailResponse(deps, cursor);
}

async function resolveCursor(
  deps: CatalogEventsDeps,
  agent: ClusterAgent,
  ack: string | undefined,
): Promise<string | null | undefined> {
  if (ack !== undefined) {
    await deps.agents.advanceCatalogCursor(agent.id, ack);
  }

  return ack ?? agent.catalogCursor;
}

function hasCursor(cursor: string | null | undefined): cursor is string {
  return cursor !== null && cursor !== undefined;
}

async function buildSnapshotResponse(
  deps: CatalogEventsDeps,
  cursor: string | null | undefined,
): Promise<{ code: 200; body: z.infer<typeof CatalogEventsResponse> }> {
  const snap = await deps.events.snapshot();
  const entries = await snapshotEntries(deps, snap.entries);

  return {
    code: 200,
    body: {
      mode: "snapshot" as const,
      // A FORCED snapshot hands back the agent's OWN stored cursor, not the max: acking past a delete-while-down event would leak its CR pair forever.
      cursor: cursor ?? snap.cursor,
      entries,
    },
  };
}

/** Every catalog entry the snapshot names, each resolved to the definition a cluster renders. */
function snapshotEntries(
  deps: CatalogEventsDeps,
  entries: readonly { name: string; projectId: string | null }[],
): Promise<Array<z.infer<typeof CatalogEntrySchema>>> {
  return Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      project_id: entry.projectId,
      definition: await deps.resolveEntry(entry.name, entry.projectId),
    })),
  );
}

async function buildTailResponse(
  deps: CatalogEventsDeps,
  cursor: string,
): Promise<{ code: 200; body: z.infer<typeof CatalogEventsResponse> }> {
  const events = await deps.events.listSince(cursor, TAIL_BATCH);
  const entries = await dedupedEntries(deps, events);
  const last = events.at(-1);

  return {
    code: 200,
    body: { mode: "tail" as const, cursor: last?.id ?? cursor, entries },
  };
}

// Two rapid saves of one entry collapse: re-resolved once per (name, project_id).
async function dedupedEntries(
  deps: CatalogEventsDeps,
  events: readonly CatalogEvent[],
): Promise<Array<z.infer<typeof CatalogEntrySchema>>> {
  const seen = new Set<string>();
  const entries: Array<z.infer<typeof CatalogEntrySchema>> = [];

  for (const event of events) {
    const key = `${event.name} ${event.projectId ?? ""}`;

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      name: event.name,
      project_id: event.projectId,
      definition: await deps.resolveEntry(event.name, event.projectId),
    });
  }

  return entries;
}
