import { describe, it, expect } from "vitest";
import { PgAgentDefs } from "./agent-defs-pg.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgAgentDefs reads/writes lore.agents through a fake PgPool (the house DB-
 * boundary stub) — proving SQL/binding + the project→org merge without a live
 * database. resolve fetches the org row and the repo's project row for a name
 * and field-merges them.
 */

type Row = Record<string, unknown>;

function fakePool(
  respond: (text: string, params?: unknown[]) => Row[],
  capture: Array<{ text: string; params?: unknown[] }> = [],
): PgPool {
  return {
    query: async (text: string, params?: unknown[]) => {
      capture.push({ text, params });
      return { rows: respond(text, params) };
    },
  };
}

const orgRow: Row = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Task: {description}",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  project_id: null,
};

describe("PgAgentDefs", () => {
  it("resolves the org default when the repo has no project row", async () => {
    const store = new PgAgentDefs(fakePool(() => [orgRow]));

    expect(await store.resolve("re-cinq/lore", "general")).toMatchObject({
      name: "general",
      model: "claude-sonnet-4-6",
      project_id: null,
    });
  });

  it("merges a project row over the org default", async () => {
    const projectRow: Row = {
      ...orgRow,
      model: "claude-haiku-4-5-20251001",
      project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };
    const store = new PgAgentDefs(fakePool(() => [orgRow, projectRow]));

    const resolved = await store.resolve("re-cinq/re-plan", "general");

    expect(resolved).toMatchObject({
      model: "claude-haiku-4-5-20251001", // project wins
      timeout_minutes: 30, // inherited
      project_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
  });

  it("returns null when no agent of that name exists", async () => {
    const store = new PgAgentDefs(fakePool(() => []));

    expect(await store.resolve("re-cinq/lore", "nope")).toBeNull();
  });

  it("binds the agent name and repo on resolve", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(fakePool(() => [orgRow], capture));

    await store.resolve("re-cinq/lore", "general");

    expect(capture[0].params).toEqual(["general", "re-cinq/lore"]);
  });

  it("creates a project row scoped to the repo and returns the definition", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const created: Row = {
      ...orgRow,
      model: "claude-opus-4-8",
      project_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    };
    const store = new PgAgentDefs(fakePool(() => [created], capture));

    const def = await store.create("re-cinq/re-plan", {
      name: "general",
      model: "claude-opus-4-8",
      timeout_minutes: 30,
      prompt: "Task: {description}",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
    });

    expect(def.model).toBe("claude-opus-4-8");
    expect(capture[0].text).toMatch(/insert into lore\.agents/i);
    expect(capture[0].params).toContain("re-cinq/re-plan");
  });

  it("deletes the repo's project row for a name, scoped to the repo", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgAgentDefs(fakePool(() => [], capture));

    await store.delete("re-cinq/re-plan", "general");

    expect(capture[0].text).toMatch(/delete from lore\.agents/i);
    expect(capture[0].params).toEqual(["general", "re-cinq/re-plan"]);
  });
});
