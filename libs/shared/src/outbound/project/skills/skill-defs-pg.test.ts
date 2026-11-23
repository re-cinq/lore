import { describe, it, expect } from "vitest";
import { PgSkillDefs } from "./skill-defs-pg.js";
import type { PgPool } from "../../memory-store.js";

type Row = Record<string, unknown>;

function fakePool(
  rows: Row[],
  capture: Array<{ text: string; params?: unknown[] }> = [],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: rows as T[] };
    },
  };
}

const orgRow: Row = {
  name: "tdd-loop",
  title: "Org TDD",
  description: "Org description",
  model: "claude-sonnet",
  content: "Org content",
  enabled: true,
  project_id: null,
};

const projectRow: Row = {
  name: "tdd-loop",
  title: "Project TDD",
  description: "Project description",
  model: null,
  content: "Project content",
  enabled: false,
  project_id: "7d3c2f5e-0000-4000-8000-000000000001",
};

describe("PgSkillDefs", () => {
  it("returns null when no skill named nope exists", async () => {
    const store = new PgSkillDefs(fakePool([]));

    expect(await store.resolve("re-cinq/lore", "nope")).toBeNull();
  });

  it("returns the org row when re-cinq/lore has no override", async () => {
    const store = new PgSkillDefs(fakePool([orgRow]));

    expect(await store.resolve("re-cinq/lore", "tdd-loop")).toEqual({
      name: "tdd-loop",
      title: "Org TDD",
      description: "Org description",
      model: "claude-sonnet",
      content: "Org content",
      enabled: true,
      projectId: null,
    });
  });

  it("returns the project row with the org model when the override sets no model", async () => {
    const store = new PgSkillDefs(fakePool([orgRow, projectRow]));

    expect(await store.resolve("re-cinq/lore", "tdd-loop")).toEqual({
      name: "tdd-loop",
      title: "Project TDD",
      description: "Project description",
      model: "claude-sonnet",
      content: "Project content",
      enabled: false,
      projectId: "7d3c2f5e-0000-4000-8000-000000000001",
    });
  });

  it("matches the override on the repo full name, not on project_id", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSkillDefs(fakePool([], capture));

    await store.resolve("re-cinq/lore", "tdd-loop");

    expect(capture[0]).toMatchObject({
      text: expect.stringContaining("r.full_name = $2"),
      params: ["tdd-loop", "re-cinq/lore"],
    });
  });

  it("reads the org row of tdd-loop with its enabled flag", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSkillDefs(fakePool([orgRow], capture));

    expect(await store.orgSkill("tdd-loop")).toEqual({
      name: "tdd-loop",
      title: "Org TDD",
      description: "Org description",
      model: "claude-sonnet",
      content: "Org content",
      enabled: true,
      projectId: null,
    });
    expect(capture[0]).toMatchObject({
      text: expect.stringContaining("project_id IS NULL"),
      params: ["tdd-loop"],
    });
  });

  it("upserts the org row of tdd-loop and keeps its enabled flag", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSkillDefs(fakePool([], capture));

    await store.putOrgSkill({
      name: "tdd-loop",
      title: "Pack TDD",
      description: "Pack description",
      model: null,
      content: "Pack content",
    });

    expect(capture[0]).toMatchObject({
      text: expect.stringMatching(
        /ON CONFLICT \(name\) WHERE project_id IS NULL DO UPDATE SET title = EXCLUDED.title/,
      ),
      params: [
        "tdd-loop",
        "Pack TDD",
        "Pack description",
        null,
        "Pack content",
      ],
    });
    expect(capture[0]?.text).not.toMatch(/enabled\s*=/);
  });

  it("deletes the org row of acme-review and leaves project rows", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSkillDefs(fakePool([], capture));

    await store.deleteOrgSkill("acme-review");

    expect(capture[0]).toMatchObject({
      text: expect.stringContaining("project_id IS NULL"),
      params: ["acme-review"],
    });
  });
});
