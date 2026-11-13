import { describe, it, expect } from "vitest";
import { versionsAnswer, type VersionSources } from "./versions-answer.js";

const STARTED = new Date("2026-11-13T10:00:00Z");

function serviceRow(service: string) {
  return {
    service,
    build: "abc1234",
    packages: { "@re-cinq/floor-client": "0.4.0" },
    startedAt: STARTED,
  };
}

function sources(overrides: Partial<VersionSources> = {}): VersionSources {
  return {
    services: async () => ["lore-api", "stations", "lore-mcp"].map(serviceRow),
    ui: async () => ({ build: "abc1234", packages: {} }),
    floorVersion: async () => ({
      sha: "f00d123",
      schemaVersion: 8,
      runsLoop: true,
      clusters: [
        {
          id: "internal-cluster",
          build: "f00d123",
          subsystem: { version: "0.19.0", clis: { "claude-cli": "2.1.311" } },
          lastSeenAt: "2026-11-13T10:01:00Z",
        },
      ],
    }),
    migrations: async () => ({
      migration: "0129_service_versions.sql",
      floorMigration: "floor/0009_x.ts",
    }),
    onFloor: async () => ({
      pipelines: [{ id: "merge", hash: "h1" }],
      agentDefinitions: 31,
    }),
    env: { LORE_BUILD_SHA: "abc1234", LORE_AGENT_IMAGE: "ghcr.io/x/agent:1" },
    ...overrides,
  };
}

const failing = async (): Promise<never> => {
  throw new Error("boom");
};

describe("versionsAnswer", () => {
  it("answers every source, with lore-api's build as the latest", async () => {
    expect(await versionsAnswer(sources())).toEqual({
      lore: {
        "lore-api": {
          build: "abc1234",
          startedAt: STARTED,
          packages: { "@re-cinq/floor-client": "0.4.0" },
        },
        stations: expect.objectContaining({ build: "abc1234" }),
        "lore-mcp": expect.objectContaining({ build: "abc1234" }),
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
      database: {
        migration: "0129_service_versions.sql",
        floorMigration: "floor/0009_x.ts",
      },
      onFloor: {
        pipelines: [{ id: "merge", hash: "h1" }],
        agentDefinitions: 31,
      },
      agentImage: "ghcr.io/x/agent:1",
    });
  });

  it("answers an error for each lore service when the service table fails, and the rest whole", async () => {
    const answer = await versionsAnswer(sources({ services: failing }));

    expect({ lore: answer.lore, latest: answer.latest }).toEqual({
      lore: {
        "lore-api": { error: "boom" },
        stations: { error: "boom" },
        "lore-mcp": { error: "boom" },
        "lore-ui": { build: "abc1234", packages: {} },
      },
      latest: { build: "abc1234" },
    });
  });

  it("answers not reported for a service with no row", async () => {
    const answer = await versionsAnswer(
      sources({ services: async () => [serviceRow("lore-api")] }),
    );

    expect(answer.lore["lore-mcp"]).toEqual({ error: "not reported" });
  });

  it("answers an error for the ui, the floor, the database and the floor's contents each alone", async () => {
    const answer = await versionsAnswer(
      sources({
        ui: failing,
        floorVersion: failing,
        migrations: failing,
        onFloor: failing,
      }),
    );

    expect({
      ui: answer.lore["lore-ui"],
      floor: answer.floor,
      database: answer.database,
      onFloor: answer.onFloor,
      api: answer.lore["lore-api"],
    }).toEqual({
      ui: { error: "boom" },
      floor: { error: "boom" },
      database: { error: "boom" },
      onFloor: { error: "boom" },
      api: expect.objectContaining({ build: "abc1234" }),
    });
  });

  it("answers no clusters from a floor that predates them", async () => {
    const answer = await versionsAnswer(
      sources({
        floorVersion: async () => ({ sha: "f00d123", schemaVersion: 3 }),
      }),
    );

    expect(answer.floor).toEqual({
      build: "f00d123",
      schemaVersion: 3,
      clusters: [],
    });
  });

  it("keeps only the clusters that parse, a subsystem-less one included", async () => {
    const answer = await versionsAnswer(
      sources({
        floorVersion: async () => ({
          sha: "f00d123",
          schemaVersion: 8,
          clusters: [
            { id: "a", build: null, subsystem: null, lastSeenAt: "t" },
            { nonsense: true },
          ],
        }),
      }),
    );

    expect(answer.floor).toMatchObject({
      clusters: [{ id: "a", build: null, subsystem: null, lastSeenAt: "t" }],
    });
  });

  it("answers dev and a null agent image for a process given neither", async () => {
    const answer = await versionsAnswer(sources({ env: {} }));

    expect({ latest: answer.latest, agentImage: answer.agentImage }).toEqual({
      latest: { build: "dev" },
      agentImage: null,
    });
  });
});
