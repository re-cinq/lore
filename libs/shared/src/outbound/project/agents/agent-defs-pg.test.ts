import { describe, it, expect } from "vitest";
import {
  PgAgentDefs,
  qualifiedStationRef,
  updateOrgDefinition,
} from "./agent-defs-pg.js";
import type { AgentDefsPort } from "./agent-defs-port.js";
import type { PgPool } from "../../memory-store.js";

type Row = Record<string, unknown>;

const yamlBase: AgentDefsPort = {
  resolve: async (_repo, name) =>
    name === "general"
      ? {
          name: "general",
          model: "claude-sonnet-4-6",
          timeout_minutes: 30,
          prompt: "YAML: {description}",
          image: null,
          execution_mode: "claude-code",
          review_required: true,
          config: null,
          project_id: null,
        }
      : null,
  list: async () => [],
  create: async () => {
    throw new Error("ro");
  },
  update: async () => {
    throw new Error("ro");
  },
  delete: async () => {},
};

function fakePool(
  respond: (text: string, params?: unknown[]) => Row[],
  capture: Array<{ text: string; params?: unknown[] }> = [],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: respond(text, params) as T[] };
    },
  };
}

const orgRow: Row = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: null,
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: null,
};

describe("PgAgentDefs", () => {
  it("resolves the org row and inherits the prompt from the yaml base", async () => {
    const store = new PgAgentDefs(
      fakePool(() => [orgRow]),
      yamlBase,
    );

    expect(await store.resolve("re-cinq/lore", "general")).toMatchObject({
      name: "general",
      model: "claude-sonnet-4-6",
      prompt: "YAML: {description}",
      project_id: null,
    });
  });

  it("merges a project row over the org default and yaml base", async () => {
    const projectRow: Row = {
      ...orgRow,
      model: "claude-haiku-4-5-20251001",
      project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };
    const store = new PgAgentDefs(
      fakePool(() => [orgRow, projectRow]),
      yamlBase,
    );

    expect(await store.resolve("re-cinq/re-plan", "general")).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      timeout_minutes: 30,
      prompt: "YAML: {description}",
      project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
  });

  it("returns null when no agent of that name exists in db or yaml", async () => {
    const store = new PgAgentDefs(
      fakePool(() => []),
      yamlBase,
    );

    expect(await store.resolve("re-cinq/lore", "nope")).toBeNull();
  });

  it("binds the agent name and repo on resolve", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(
      fakePool(() => [orgRow], capture),
      yamlBase,
    );

    await store.resolve("re-cinq/lore", "general");

    expect(capture[0].params).toEqual(["general", "re-cinq/lore"]);
  });

  it("qualifies selected columns so the lore.repos JOIN is not ambiguous", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(
      fakePool(() => [orgRow], capture),
      yamlBase,
    );

    await store.list("re-cinq/lore");

    expect(capture[0].text).toMatch(/LEFT JOIN lore\.repos/);
    expect(capture[0].text).toContain("a.name");
    expect(capture[0].text).not.toMatch(/SELECT\s+name\b/);
  });

  it("creates a project row scoped to the repo and returns the definition", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const created: Row = {
      ...orgRow,
      model: "claude-opus-4-8",
      project_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };
    const store = new PgAgentDefs(
      fakePool(() => [created], capture),
      yamlBase,
    );

    const def = await store.create("re-cinq/re-plan", {
      name: "general",
      model: "claude-opus-4-8",
      timeout_minutes: 30,
      prompt: "Task: {description}",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      config: null,
    });

    expect(def.model).toBe("claude-opus-4-8");
    expect(capture[0].text).toMatch(/insert into lore\.agent_definitions/i);
    expect(capture[0].params).toContain("re-cinq/re-plan");
  });

  it("deletes the repo's project row for a name, scoped to the repo", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(
      fakePool(() => [], capture),
      yamlBase,
    );

    await store.delete("re-cinq/re-plan", "general");

    expect(capture[0].text).toMatch(/delete from lore\.agent_definitions/i);
    expect(capture[0].params).toEqual(["general", "re-cinq/re-plan"]);
  });

  it("create, update and delete each append a lore.catalog_events row in the same statement", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(
      fakePool(() => [orgRow], capture),
      yamlBase,
    );
    const input = {
      name: "general",
      model: null,
      timeout_minutes: null,
      prompt: null,
      image: null,
      execution_mode: "claude-code",
      review_required: false,
      config: null,
    };

    await store.create("re-cinq/re-plan", input);
    await store.update("re-cinq/re-plan", "general", input);
    await store.delete("re-cinq/re-plan", "general");

    for (const call of capture) {
      expect(call.text).toMatch(/insert into lore\.catalog_events/i);
    }
    expect(capture[2].text).toMatch(/'delete' from removed/i);
  });
});

describe("updateOrgDefinition", () => {
  it("upserts the org row (project_id NULL conflict target) and appends a catalog event in one statement", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const written: Row = { ...orgRow, timeout_minutes: 60 };

    const def = await updateOrgDefinition(
      fakePool(() => [written], capture),
      {
        name: "general",
        model: "claude-sonnet-4-6",
        timeout_minutes: 60,
        prompt: null,
        image: null,
        execution_mode: "claude-code",
        review_required: true,
        config: null,
      },
    );

    expect(def.timeout_minutes).toBe(60);
    expect(def.project_id).toBeNull();
    expect(capture[0].text).toMatch(
      /on conflict \(name\) where project_id is null/i,
    );
    expect(capture[0].text).toMatch(/insert into lore\.catalog_events/i);
    expect(capture[0].params?.[0]).toBe("general");
  });

  it("without a pod_resources write binds touched=false and keeps the row's config in the conflict branch", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];

    await updateOrgDefinition(
      fakePool(() => [orgRow], capture),
      {
        name: "general",
        model: null,
        timeout_minutes: null,
        prompt: null,
        image: null,
        execution_mode: "claude-code",
        review_required: false,
        config: null,
      },
    );

    expect(capture[0].params?.slice(8)).toEqual([false, null, null]);
    expect(capture[0].text).toMatch(
      /config = CASE WHEN \$9::boolean[\s\S]*ELSE lore\.agent_definitions\.config END/,
    );
  });

  it("with a pod_resources write merges the block over the row's own config in SQL, the inherited layer as fallback", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];

    await updateOrgDefinition(
      fakePool(() => [orgRow], capture),
      {
        name: "general",
        model: null,
        timeout_minutes: null,
        prompt: null,
        image: null,
        execution_mode: "claude-code",
        review_required: false,
        config: null,
      },
      {
        podResources: { limits: { memory: "4Gi" } },
        inheritedConfig: { skills: ["lore-context"] },
      },
    );

    expect(capture[0].params?.slice(8)).toEqual([
      true,
      { skills: ["lore-context"] },
      { pod_resources: { limits: { memory: "4Gi" } } },
    ]);
    expect(capture[0].text).toMatch(
      /COALESCE\(lore\.agent_definitions\.config, \$10::jsonb, '\{\}'::jsonb\) - 'pod_resources'\)\s*\|\| COALESCE\(\$11::jsonb/,
    );
  });

  it("a null pod_resources write removes the block: binds touched=true with no block so an emptied config collapses to NULL", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];

    await updateOrgDefinition(
      fakePool(() => [orgRow], capture),
      {
        name: "general",
        model: null,
        timeout_minutes: null,
        prompt: null,
        image: null,
        execution_mode: "claude-code",
        review_required: false,
        config: null,
      },
      { podResources: null, inheritedConfig: null },
    );

    expect(capture[0].params?.slice(8)).toEqual([true, null, null]);
    expect(capture[0].text).toMatch(/NULLIF\([\s\S]*'\{\}'::jsonb\)/);
  });
});

describe("PgAgentDefs.update with a pod_resources write", () => {
  it("binds touched, inherited config and block after the repo and merges in the project row's conflict branch", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(
      fakePool(() => [orgRow], capture),
      yamlBase,
    );

    await store.update(
      "re-cinq/re-plan",
      "general",
      { model: "claude-opus-4-8" },
      {
        podResources: { requests: { cpu: "500m" } },
        inheritedConfig: { skills: ["lore-context"] },
      },
    );

    expect(capture[0].params?.slice(8)).toEqual([
      "re-cinq/re-plan",
      true,
      { skills: ["lore-context"] },
      { pod_resources: { requests: { cpu: "500m" } } },
    ]);
    expect(capture[0].text).toMatch(
      /config = CASE WHEN \$10::boolean[\s\S]*COALESCE\(lore\.agent_definitions\.config, \$11::jsonb/,
    );
  });
});

describe("qualifiedStationRef", () => {
  function capturingPool(rows: Row[]) {
    const capture: Array<{ text: string; params?: unknown[] }> = [];

    return { pool: fakePool(() => rows, capture), capture };
  }

  it("qualifies to the override's CRD name when a repo row exists", async () => {
    const { pool } = capturingPool([
      { project_id: "2263bc7a-0767-42ef-80f0-fc6bc5dea98c" },
    ]);

    expect(
      await qualifiedStationRef(pool, "code-review", "re-cinq/lore"),
    ).toEqual("code-review--r2263bc7a");
  });

  it("keeps the bare org-default name when the repo has no override", async () => {
    const { pool } = capturingPool([]);

    expect(
      await qualifiedStationRef(pool, "code-review", "re-cinq/lore"),
    ).toEqual("code-review");
  });

  it("excludes an override every cluster refused, so dispatch cannot point at a CR that will never exist", async () => {
    const { pool, capture } = capturingPool([]);

    await qualifiedStationRef(pool, "code-review", "re-cinq/lore");

    expect(capture[0].text).toContain("catalog_apply_status");
    expect(capture[0].text).toContain("'refused'");
    expect(capture[0].text).toContain("'applied'");
  });

  it("binds the definition name and the repo, never interpolating them", async () => {
    const { pool, capture } = capturingPool([]);

    await qualifiedStationRef(pool, "code-review", "re-cinq/lore");

    expect(capture[0].params).toEqual(["code-review", "re-cinq/lore"]);
  });
});
