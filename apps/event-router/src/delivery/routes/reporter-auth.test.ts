/**
 * FR5 of specs/running-stations-in-any-k8s-cluster, driven through the real
 * route: POST /api/events accepts a per-agent token whose SHA-256 matches a
 * `pipeline.cluster_agents.token_hash` row, rotation revokes the old token,
 * offline status does not block a late terminal report, and the bus-wide
 * ingest token keeps working. The registry is the in-memory double — no
 * Postgres.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import type { EventInsert } from "@re-cinq/lore-shared";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { mintAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { eventsRoute } from "./events.js";

const INGEST_TOKEN = "tok-1";

let inserted: EventInsert[];
let registry: InMemoryClusterAgents;

function server(): Hapi.Server {
  const s = Hapi.server({ port: 0 });

  s.route(
    eventsRoute({
      insert: async (ev) => {
        inserted.push(ev);
      },
      webhookSecret: "shhh",
      bearerToken: INGEST_TOKEN,
      findByTokenHash: (hash) => registry.findByTokenHash(hash),
    }),
  );

  return s;
}

function registration(tokenHash: string) {
  return { name: "satellite-1", tags: ["gpu"], tokenHash, clusterInfo: null };
}

function report(token: string) {
  return {
    method: "POST" as const,
    url: "/api/events",
    headers: { authorization: `Bearer ${token}` },
    payload: JSON.stringify(event),
  };
}

const event = {
  eventName: "kubernetes.agent_node.succeeded",
  source: "kubernetes",
  params: { assemblyLineId: "line-1", nodeId: "review" },
  dedupeKey: "cr-1:Succeeded",
};

beforeEach(() => {
  inserted = [];
  registry = new InMemoryClusterAgents();
});

describe("POST /api/events — per-agent tokens (FR5)", () => {
  it("inserts an event reported with a registered per-agent token", async () => {
    const { token, tokenHash } = mintAgentToken();

    await registry.create(registration(tokenHash));

    const res = await server().inject(report(token));

    expect(res.statusCode).toBe(202);
    expect(inserted).toEqual([event]);
  });

  it("refuses the pre-rotation token with 401 once the agent rotates", async () => {
    const { token, tokenHash } = mintAgentToken();
    const agent = await registry.create(registration(tokenHash));

    enforceTrue(agent, Error, "name already registered");
    await registry.rotate(agent.id, registration(mintAgentToken().tokenHash));

    const res = await server().inject(report(token));

    expect(res.statusCode).toBe(401);
    expect(inserted).toEqual([]);
  });

  it("accepts a late terminal report from an agent already marked offline", async () => {
    const { token, tokenHash } = mintAgentToken();

    await registry.create(registration(tokenHash));
    await registry.markOffline(new Date(Date.now() + 60_000));

    const res = await server().inject(report(token));

    expect(res.statusCode).toBe(202);
    expect(inserted).toEqual([event]);
  });

  it("refuses an unregistered token with 401 exactly as before", async () => {
    const res = await server().inject(report(mintAgentToken().token));

    expect(res.statusCode).toBe(401);
    expect((res.result as { error: string }).error).toMatch(
      /missing or invalid bearer token/,
    );
    expect(inserted).toEqual([]);
  });

  it("inserts an event posted with LORE_INGEST_TOKEN while the registry holds agents", async () => {
    await registry.create(registration(mintAgentToken().tokenHash));

    const res = await server().inject(report(INGEST_TOKEN));

    expect(res.statusCode).toBe(202);
    expect(inserted).toEqual([event]);
  });
});
