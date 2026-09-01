import { describe, it, expect } from "vitest";
import { PgAgentDefs } from "./agent-defs-pg.js";
import type { AgentDefsPort } from "./agent-defs-port.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgAgentDefs reads/writes lore.agent_definitions through a fake PgPool (the house DB-
 * boundary stub) — proving SQL/binding + the project→org→yaml merge without a
 * live database. The yaml base supplies the bottom layer (prompt) so seeded org
 * rows can leave it null.
 */

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

// A seeded org row carries the scalar knobs but leaves prompt NULL (inherits yaml).
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
      model: "claude-sonnet-4-6", // from the seeded org row
      prompt: "YAML: {description}", // inherited from the yaml base
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
      model: "claude-haiku-4-5-20251001", // project wins
      timeout_minutes: 30, // inherited from org
      prompt: "YAML: {description}", // inherited from yaml
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
    // lore.repos also has a `name` column — an unqualified SELECT throws
    // "column reference name is ambiguous" against a real database.
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
