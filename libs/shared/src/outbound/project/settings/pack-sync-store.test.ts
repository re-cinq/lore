import { describe, expect, it } from "vitest";
import type { PackSyncState } from "../../../domain/models/pack-sync-state.js";
import type { Pool } from "pg";
import { packManagedNames, parsePackSync } from "./pack-sync-store.js";

const poolHolding = (value: PackSyncState) =>
  ({
    query: async () => ({ rows: [{ value: JSON.stringify(value) }] }),
  }) as unknown as Pool;

const state: PackSyncState = {
  repo: "acme/lore-pack",
  ref: null,
  commit: "9a7b72d96c4cbaadf77c7bcdc9f885dfb099c36d",
  applied_at: "2026-11-17T10:00:00.000Z",
  agent_count: 1,
  line_count: 0,
  extra_count: 0,
  refused_files: [],
  agents: ["acme-triage"],
  pipelines: ["acme-flow"],
  skill_count: 1,
  skills: ["acme-review"],
  error: null,
  error_at: null,
};

describe("parsePackSync", () => {
  it("returns null when the setting is unset", () => {
    expect(parsePackSync(null)).toBeNull();
  });

  it("returns the state stored as JSON text", () => {
    expect(parsePackSync(JSON.stringify(state))).toEqual(state);
  });

  it("throws naming pack.sync when the stored text is not a state", () => {
    expect(() => parsePackSync('{"repo":1}')).toThrow(
      /^lore\.settings pack\.sync is not a pack sync state/,
    );
  });
});

describe("packManagedNames", () => {
  const env = { LORE_PACK_REPO: "acme/lore-pack" };

  it("lists the skills the last sync set while LORE_PACK_REPO is set", async () => {
    expect(await packManagedNames(poolHolding(state), "skills", env)).toEqual([
      "acme-review",
    ]);
  });

  it("lists the agents and the pipelines the last sync set, by kind", async () => {
    expect({
      agents: await packManagedNames(poolHolding(state), "agents", env),
      pipelines: await packManagedNames(poolHolding(state), "pipelines", env),
    }).toEqual({ agents: ["acme-triage"], pipelines: ["acme-flow"] });
  });

  it("lists nothing once LORE_PACK_REPO is unset, whatever the last sync recorded", async () => {
    expect(await packManagedNames(poolHolding(state), "skills", {})).toEqual(
      [],
    );
  });

  it("lists nothing without a database", async () => {
    expect(await packManagedNames(null, "skills", env)).toEqual([]);
  });
});
