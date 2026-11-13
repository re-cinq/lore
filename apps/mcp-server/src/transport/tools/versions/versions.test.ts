import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import {
  registerVersionsTool,
  renderVersions,
  type LoreVersions,
} from "./versions.js";

const versionsTool = toolHandlers(registerVersionsTool, "full")[
  "lore_versions"
];
const fetchMock = vi.fn();

const ALL_UP: LoreVersions = {
  lore: {
    "lore-api": {
      build: "abc1234",
      startedAt: "2026-11-13T10:00:00.000Z",
      packages: { "@re-cinq/floor-client": "0.4.0" },
    },
    stations: { error: "not reported" },
    "lore-mcp": {
      build: "abc1234",
      startedAt: "2026-11-13T10:00:00.000Z",
      packages: {},
    },
    "lore-ui": { build: "abc1234", packages: {} },
  },
  latest: { build: "abc1234" },
  floor: {
    build: "f00d123",
    schemaVersion: 8,
    clusters: [
      {
        id: "internal-cluster",
        build: "f00d123",
        subsystem: { version: "0.19.0", clis: { "claude-cli": "2.1.311" } },
        lastSeenAt: "2026-11-13T10:01:00Z",
      },
    ],
  },
  database: { migration: "0129_service_versions.sql", floorMigration: null },
  onFloor: {
    pipelines: [
      { id: "merge", hash: "h1" },
      { id: "onboard", hash: null },
    ],
    agentDefinitions: 31,
  },
  agentImage: "ghcr.io/re-cinq/agent:1",
};

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("renderVersions", () => {
  it("prints each part on its own line, an error where a part failed", () => {
    expect(renderVersions(ALL_UP, null)).toBe(
      [
        "Latest Lore build: abc1234",
        "- lore-api: abc1234, started 2026-11-13T10:00:00.000Z (@re-cinq/floor-client 0.4.0)",
        "- stations: error: not reported",
        "- lore-mcp: abc1234, started 2026-11-13T10:00:00.000Z",
        "- lore-ui: abc1234",
        "- floor: f00d123, schema 8",
        "  - cluster internal-cluster: floor agent f00d123, subsystem 0.19.0 (claude-cli 2.1.311), seen 2026-11-13T10:01:00Z",
        "- database: 0129_service_versions.sql, floor migrations none",
        "- on the floor: 2 pipelines (missing: onboard), 31 agent definitions",
        "- agent image: ghcr.io/re-cinq/agent:1",
      ].join("\n"),
    );
  });

  it("adds this adapter's build and that it matches the latest", () => {
    expect(renderVersions(ALL_UP, "abc1234").split("\n").at(-1)).toBe(
      "- this adapter: abc1234, the latest",
    );
  });

  it("tells an adapter behind the latest to run lore_update", () => {
    expect(renderVersions(ALL_UP, "0ld0000").split("\n").at(-1)).toBe(
      "- this adapter: 0ld0000, behind abc1234: run lore_update",
    );
  });

  it("prints a cluster with no subsystem and errors for the floor's other parts", () => {
    const text = renderVersions(
      {
        ...ALL_UP,
        floor: {
          build: "f00d123",
          schemaVersion: 8,
          clusters: [
            { id: "c", build: null, subsystem: null, lastSeenAt: "t" },
          ],
        },
        database: { error: "database unavailable" },
        onFloor: { error: "no floor configured" },
        agentImage: null,
      },
      null,
    );

    expect(text.split("\n").slice(6)).toEqual([
      "  - cluster c: floor agent unknown, subsystem unknown, seen t",
      "- database: error: database unavailable",
      "- on the floor: error: no floor configured",
      "- agent image: none",
    ]);
  });
});

describe("lore_versions", () => {
  it("proxies GET /api/versions and prints the list", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ALL_UP });

    const result = await versionsTool({});

    expect({
      url: fetchMock.mock.calls[0]?.[0],
      first: result.content[0].text.split("\n")[0],
    }).toEqual({
      url: "https://lore-api.example.com/api/versions",
      first: "Latest Lore build: abc1234",
    });
  });

  it("reports a missing API configuration", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const result = await versionsTool({});

    expect(result.content[0].text).toContain(
      "Lore API not configured for fetching versions",
    );
  });
});
