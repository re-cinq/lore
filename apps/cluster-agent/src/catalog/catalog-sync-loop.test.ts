import { describe, it, expect } from "vitest";
import {
  catalogProfile,
  catalogSyncOnce,
  crdOptionsFromEnv,
  enforceCatalogProfile,
  nextSyncDelay,
  parseModelSecretKeys,
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
      outcome: {
        kind: "synced",
        applied: 1,
        deleted: 0,
        skipped: [],
        refused: [],
      },
      ack: "7",
    });
    expect(applied).toEqual(["implementation"]);
  });

  it("a boot resync asks the server for the full snapshot with snapshot=1", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(String(url));

      return new Response(
        JSON.stringify({ mode: "snapshot", cursor: "9", entries: [] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { catalog } = recordingCatalog();

    await catalogSyncOnce(tickDeps(catalog, fetchFn), undefined, true);
    await catalogSyncOnce(tickDeps(catalog, fetchFn), "9", false);

    expect(urls).toEqual([
      "https://api.example/api/cluster-agents/agent-1/catalog-events?snapshot=1",
      "https://api.example/api/cluster-agents/agent-1/catalog-events?ack=9",
    ]);
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
      skipped: [],
      refused: [],
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
      skipped: ["implementation (lore-catalog-seed)"],
      refused: [],
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
      skipped: [],
      refused: [],
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

  it("a render-contract refusal is acked past with its reason, never re-served — the def-github_action head-of-line block", async () => {
    const { catalog, applied } = recordingCatalog();
    const result = await catalogSyncOnce(
      tickDeps(
        catalog,
        respondWith(200, {
          mode: "tail",
          cursor: "9",
          entries: [
            {
              name: "def-github_action",
              project_id: null,
              definition: {
                ...def("def-github_action"),
                execution_mode: "station",
              },
            },
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

    expect(result.ack).toEqual("9");
    expect(result.outcome).toMatchObject({
      kind: "synced",
      applied: 1,
      refused: [
        expect.stringContaining(
          '"def-github_action" is not a valid Kubernetes resource name',
        ),
      ],
    });
    expect(applied).toEqual(["implementation"]);
  });

  it("an apiserver 422 refuses permanently and the batch still acks; a 500 stays transient and re-serves", async () => {
    const body = {
      mode: "tail",
      cursor: "9",
      entries: [
        {
          name: "implementation",
          project_id: null,
          definition: def("implementation"),
        },
      ],
    };
    const permanent = recordingCatalog();

    permanent.catalog.applyPair = async () => {
      throw new Error("HTTP-Code: 422\nMessage: invalid");
    };
    const refused = await catalogSyncOnce(
      tickDeps(permanent.catalog, respondWith(200, body)),
      "3",
    );

    expect(refused).toMatchObject({
      ack: "9",
      outcome: { kind: "synced" },
    });

    const transient = recordingCatalog();

    transient.catalog.applyPair = async () => {
      throw new Error("HTTP-Code: 503\nMessage: apiserver unavailable");
    };
    const retried = await catalogSyncOnce(
      tickDeps(transient.catalog, respondWith(200, body)),
      "3",
    );

    expect(retried).toMatchObject({
      ack: "3",
      outcome: { kind: "error" },
    });
  });

  it("the loop owns UI-labeled CRs (repairing the push path's degraded render) but never an unlabeled hand-applied one", async () => {
    const label = (managedBy?: string): AgentDefinition => ({
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: {
        name: "code-review",
        ...(managedBy
          ? { labels: { "app.kubernetes.io/managed-by": managedBy } }
          : {}),
      },
    });
    const body = {
      mode: "tail",
      cursor: "5",
      entries: [
        {
          name: "code-review",
          project_id: null,
          definition: def("code-review"),
        },
      ],
    };

    const uiOwned = recordingCatalog({
      "code-review": label("lore-catalog-ui"),
    });
    const repaired = await catalogSyncOnce(
      tickDeps(uiOwned.catalog, respondWith(200, body)),
      undefined,
    );

    expect(repaired.outcome).toMatchObject({ kind: "synced", applied: 1 });
    expect(uiOwned.applied).toEqual(["code-review"]);

    const handApplied = recordingCatalog({ "code-review": label() });
    const respected = await catalogSyncOnce(
      tickDeps(handApplied.catalog, respondWith(200, body)),
      undefined,
    );

    expect(respected.outcome).toMatchObject({
      kind: "synced",
      applied: 0,
      skipped: ["code-review (unlabeled)"],
    });
    expect(handApplied.applied).toEqual([]);
  });
});

describe("parseModelSecretKeys", () => {
  it("parses a JSON family→key object and throws on anything malformed instead of silently degrading", () => {
    expect(
      parseModelSecretKeys(
        '{"anthropic":"ANTHROPIC_API_KEY","gemini":"GEMINI_API_KEY"}',
      ),
    ).toEqual({
      anthropic: "ANTHROPIC_API_KEY",
      gemini: "GEMINI_API_KEY",
    });
    expect(() => parseModelSecretKeys("anthropic=ANTHROPIC_API_KEY")).toThrow();
    expect(() => parseModelSecretKeys('{"anthropic":""}')).toThrow(
      /JSON object of family→secret-key strings/,
    );
  });
});

describe("catalog profile", () => {
  it("full requires the mcp, skills and events URLs plus an anthropic credential; bare requires nothing", () => {
    expect(catalogProfile({})).toEqual("bare");
    expect(() => enforceCatalogProfile({})).not.toThrow();
    expect(() =>
      enforceCatalogProfile({
        LORE_CATALOG_PROFILE: "full",
        LORE_MCP_URL: "http://mcp",
        LORE_AGENT_EVENTS_URL: "http://events",
      }),
    ).toThrow(/LORE_SKILLS_URL is unset/);
    expect(() =>
      enforceCatalogProfile({
        LORE_CATALOG_PROFILE: "full",
        LORE_MCP_URL: "http://mcp",
        LORE_SKILLS_URL: "http://mcp/skills",
        LORE_AGENT_EVENTS_URL: "http://events",
      }),
    ).toThrow(/no anthropic credential key/);
    expect(() =>
      enforceCatalogProfile({
        LORE_CATALOG_PROFILE: "full",
        LORE_MCP_URL: "http://mcp",
        LORE_SKILLS_URL: "http://mcp/skills",
        LORE_AGENT_EVENTS_URL: "http://events",
        LORE_AGENT_LLM_SECRET_KEY: "ANTHROPIC_API_KEY",
      }),
    ).not.toThrow();
  });

  it('a typo\'d profile ("Full") refuses to boot instead of silently reading as bare', () => {
    expect(() => catalogProfile({ LORE_CATALOG_PROFILE: "Full" })).toThrow(
      /unknown LORE_CATALOG_PROFILE/,
    );
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
          skipped: [],
          refused: [],
        },
        ack: "4",
      },
      { outcome: { kind: "empty" as const }, ack: "4" },
    ];
    let reRegistered = 0;
    let firstSyncs = 0;
    let ticks = 0;

    const snapshots: boolean[] = [];

    await runCatalogSyncLoop({
      sync: async (ack, snapshot) => {
        acks.push(ack);
        snapshots.push(snapshot);

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
    expect(snapshots).toEqual([true, true, false]);
    expect(reRegistered).toEqual(1);
    expect(firstSyncs).toEqual(1);
  });
});

describe("status reporting", () => {
  function withStatusCapture(body: unknown) {
    const posts: Array<{ url: string; payload: unknown }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, payload: JSON.parse(String(init.body)) });

        return new Response(null, { status: 200 });
      }

      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    return { fetchFn, posts };
  }

  const batch = {
    mode: "tail",
    cursor: "9",
    entries: [
      {
        name: "implementation",
        project_id: null,
        definition: def("implementation"),
      },
      {
        name: "def-github_action",
        project_id: null,
        definition: { ...def("def-github_action"), execution_mode: "station" },
      },
      { name: "gone", project_id: "p-1", definition: null },
    ],
  };

  it("reports one structured verdict per entry — applied, refused with its reason, and deleted", async () => {
    const { catalog } = recordingCatalog();
    const { fetchFn, posts } = withStatusCapture(batch);

    await catalogSyncOnce(tickDeps(catalog, fetchFn), "3");

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain(
      "/api/cluster-agents/agent-1/catalog-status",
    );
    expect(posts[0].payload).toMatchObject({
      reports: [
        {
          name: "implementation",
          project_id: null,
          state: "applied",
          reason: null,
        },
        {
          name: "def-github_action",
          project_id: null,
          state: "refused",
          reason: expect.stringContaining(
            "not a valid Kubernetes resource name",
          ),
        },
        { name: "gone", project_id: "p-1", state: "deleted", reason: null },
      ],
    });
  });

  it("a refused status report never fails the sync — visibility must not cost delivery", async () => {
    const { catalog } = recordingCatalog();
    const fetchFn = (async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(null, { status: 500 })
        : new Response(JSON.stringify(batch), {
            status: 200,
          })) as unknown as typeof fetch;

    const result = await catalogSyncOnce(tickDeps(catalog, fetchFn), "3");

    expect(result).toMatchObject({
      ack: "9",
      outcome: { kind: "synced", applied: 1 },
    });
  });

  it("posts nothing when the batch was empty", async () => {
    const { catalog } = recordingCatalog();
    const { fetchFn, posts } = withStatusCapture({
      mode: "tail",
      cursor: "9",
      entries: [],
    });

    await catalogSyncOnce(tickDeps(catalog, fetchFn), "3");

    expect(posts).toEqual([]);
  });
});
