import { describe, it, expect } from "vitest";
import {
  catalogSyncOnce,
  crdOptionsFromEnv,
  nextSyncDelay,
  runCatalogSyncLoop,
  SYNC_BASE_INTERVAL_S_DEFAULT,
  syncIntervalMs,
  type CatalogSyncTickDeps,
  type CatalogTarget,
} from "./catalog-sync-loop.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";

const identity = () => ({ id: "agent-1", token: "lca_secret" });

const def = (name: string): ResolvedAgentDefinition => ({
  name,
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Do the thing.",
  image: null,
  execution_mode: "claude-code",
  review_required: false,
  project_id: null,
  config: null,
});

function recordingCatalog(live: Record<string, AgentDefinition> = {}) {
  const applied: string[] = [];
  const deletedNames: string[] = [];
  const catalog: CatalogTarget = {
    applyPair: async (pair: {
      agentDefinition: AgentDefinition;
      station: Station;
    }) => {
      applied.push(pair.agentDefinition.metadata?.name ?? "");
    },
    deletePair: async (name: string) => {
      deletedNames.push(name);
    },
    getAgentDefinition: async (name: string) => live[name] ?? null,
  };

  return { catalog, applied, deletedNames };
}

function respondWith(status: number, body?: unknown): typeof fetch {
  return (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
    })) as typeof fetch;
}

const tickDeps = (
  catalog: CatalogTarget,
  fetchFn: typeof fetch,
  over: Partial<CatalogSyncTickDeps> = {},
): CatalogSyncTickDeps => ({
  apiUrl: "https://api.example",
  identity,
  catalog,
  crdOptions: {},
  ownSeeded: false,
  fetchFn,
  ...over,
});

describe("crdOptionsFromEnv", () => {
  it("maps each set env var and omits every unset one", () => {
    expect(
      crdOptionsFromEnv({
        LORE_AGENT_EVENTS_URL: "https://floor/api/agent-events",
        LORE_MCP_URL: "https://mcp",
        LORE_SKILLS_URL: "https://mcp/skills",
        LORE_API_URL: "https://api",
        LORE_AGENT_LLM_SECRET_KEY: "ANTHROPIC_API_KEY",
        LORE_STATION_IMAGE: "ghcr.io/re-cinq/lore-station:abc",
        LORE_DGRAPH_HTTP: "http://dgraph:8080",
      }),
    ).toEqual({
      eventsUrl: "https://floor/api/agent-events",
      mcpUrl: "https://mcp",
      skillsUrl: "https://mcp/skills",
      apiUrl: "https://api",
      llmSecretKey: "ANTHROPIC_API_KEY",
      stationImage: "ghcr.io/re-cinq/lore-station:abc",
      dgraphUrl: "http://dgraph:8080",
    });
    expect(crdOptionsFromEnv({})).toEqual({});
  });
});

describe("catalogSyncOnce", () => {
  it("applies each resolved entry as a CRD pair and returns the cursor to ack", async () => {
    const { catalog, applied } = recordingCatalog();
    const result = await catalogSyncOnce(
      tickDeps(
        catalog,
        respondWith(200, {
          mode: "tail",
          cursor: "7",
          entries: [
            {
              name: "implementation",
              project_id: null,
              definition: def("implementation"),
            },
          ],
        }),
      ),
      "3",
    );

    expect(result).toEqual({
      outcome: { kind: "synced", applied: 1, deleted: 0, skipped: 0 },
      ack: "7",
    });
    expect(applied).toEqual(["implementation"]);
  });

  it("a null definition deletes the pair under the project-qualified name", async () => {
    const { catalog, deletedNames } = recordingCatalog();
    const result = await catalogSyncOnce(
      tickDeps(
        catalog,
        respondWith(200, {
          mode: "tail",
          cursor: "9",
          entries: [
            {
              name: "implementation",
              project_id: "123e4567-e89b-42d3-a456-426614174000",
              definition: null,
            },
          ],
        }),
      ),
      undefined,
    );

    expect(result.outcome).toEqual({
      kind: "synced",
      applied: 0,
      deleted: 1,
      skipped: 0,
    });
    expect(deletedNames).toEqual(["implementation--r123e4567"]);
  });

  it("skips a seed-owned CR until ownSeeded is flipped, then applies over it", async () => {
    const seedOwned: AgentDefinition = {
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: {
        name: "implementation",
        labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" },
      },
    };
    const body = {
      mode: "tail",
      cursor: "5",
      entries: [
        {
          name: "implementation",
          project_id: null,
          definition: def("implementation"),
        },
      ],
    };
    const guarded = recordingCatalog({ implementation: seedOwned });
    const guardedResult = await catalogSyncOnce(
      tickDeps(guarded.catalog, respondWith(200, body)),
      undefined,
    );

    expect(guardedResult.outcome).toEqual({
      kind: "synced",
      applied: 0,
      deleted: 0,
      skipped: 1,
    });
    expect(guarded.applied).toEqual([]);

    const owning = recordingCatalog({ implementation: seedOwned });
    const owningResult = await catalogSyncOnce(
      tickDeps(owning.catalog, respondWith(200, body), { ownSeeded: true }),
      undefined,
    );

    expect(owningResult.outcome).toEqual({
      kind: "synced",
      applied: 1,
      deleted: 0,
      skipped: 0,
    });
  });

  it("an empty batch is idle but still advances the ack so an empty snapshot lands in tail mode", async () => {
    const { catalog } = recordingCatalog();
    const result = await catalogSyncOnce(
      tickDeps(
        catalog,
        respondWith(200, { mode: "snapshot", cursor: "0", entries: [] }),
      ),
      undefined,
    );

    expect(result).toEqual({ outcome: { kind: "empty" }, ack: "0" });
  });

  it("a failed entry keeps the previous ack so the whole batch is re-served", async () => {
    const { catalog } = recordingCatalog();

    catalog.applyPair = async () => {
      throw new Error("apiserver unavailable");
    };
    const result = await catalogSyncOnce(
      tickDeps(
        catalog,
        respondWith(200, {
          mode: "tail",
          cursor: "7",
          entries: [
            {
              name: "implementation",
              project_id: null,
              definition: def("implementation"),
            },
          ],
        }),
      ),
      "3",
    );

    expect(result.ack).toEqual("3");
    expect(result.outcome.kind).toEqual("error");
  });

  it("a 401 is the unauthorized outcome, not an error", async () => {
    const { catalog } = recordingCatalog();
    const result = await catalogSyncOnce(
      tickDeps(catalog, respondWith(401)),
      "3",
    );

    expect(result).toEqual({ outcome: { kind: "unauthorized" }, ack: "3" });
  });
});

describe("nextSyncDelay", () => {
  it("only consecutive empties back off, doubling to the cap", () => {
    expect(nextSyncDelay(30_000, 0, "empty")).toEqual(30_000);
    expect(nextSyncDelay(30_000, 3, "empty")).toEqual(240_000);
    expect(nextSyncDelay(30_000, 10, "empty")).toEqual(300_000);
    expect(nextSyncDelay(30_000, 5, "synced")).toEqual(30_000);
    expect(nextSyncDelay(30_000, 5, "error")).toEqual(30_000);
  });
});

describe("syncIntervalMs", () => {
  it("reads LORE_CLUSTER_AGENT_CATALOG_SYNC_INTERVAL_S with a 30s default", () => {
    expect(syncIntervalMs({})).toEqual(SYNC_BASE_INTERVAL_S_DEFAULT * 1000);
    expect(
      syncIntervalMs({ LORE_CLUSTER_AGENT_CATALOG_SYNC_INTERVAL_S: "5" }),
    ).toEqual(5000);
  });
});

describe("runCatalogSyncLoop", () => {
  it("signals the first successful sync once, threads the ack between ticks, and rotates on 401", async () => {
    const acks: Array<string | undefined> = [];
    const outcomes = [
      { outcome: { kind: "unauthorized" as const }, ack: undefined },
      {
        outcome: {
          kind: "synced" as const,
          applied: 1,
          deleted: 0,
          skipped: 0,
        },
        ack: "4",
      },
      { outcome: { kind: "empty" as const }, ack: "4" },
    ];
    let reRegistered = 0;
    let firstSyncs = 0;
    let ticks = 0;

    await runCatalogSyncLoop({
      sync: async (ack) => {
        acks.push(ack);

        return outcomes[ticks++] ?? { outcome: { kind: "empty" }, ack };
      },
      reRegister: async () => {
        reRegistered += 1;
      },
      sleep: async () => {},
      baseDelayMs: 1,
      running: () => ticks < 3,
      onFirstSync: () => {
        firstSyncs += 1;
      },
    });

    expect(acks).toEqual([undefined, undefined, "4"]);
    expect(reRegistered).toEqual(1);
    expect(firstSyncs).toEqual(1);
  });
});
