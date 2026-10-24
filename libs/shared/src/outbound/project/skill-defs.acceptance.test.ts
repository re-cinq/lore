import { describe, it, expect } from "vitest";

import { PgSkillDefs } from "./skill-defs-pg.js";

type Row = Record<string, unknown>;

function fakePool(respond: (text: string, params?: unknown[]) => Row[]): any {
  return {
    query: async (text: string, params?: unknown[]) => ({
      rows: respond(text, params),
    }),
  };
}

describe("PgSkillDefs resolution", () => {
  it("merges per-project skill row over org-level skill row", async () => {
    const orgRow = {
      name: "tdd-loop",
      title: "Org TDD",
      description: "Org description",
      model: "claude-sonnet",
      content: "Org content",
      enabled: true,
      project_id: null,
    };

    const projectRow = {
      name: "tdd-loop",
      title: "Project TDD",
      description: null,
      model: "claude-opus",
      content: "Project content",
      enabled: true,
      project_id: "repo/a",
    };

    const pool = fakePool(() => [projectRow, orgRow]);

    const defs = new PgSkillDefs(pool);
    const resolved = await defs.resolve("repo/a", "tdd-loop");

    expect(resolved).toEqual({
      name: "tdd-loop",
      title: "Project TDD",
      description: "Org description",
      model: "claude-opus",
      content: "Project content",
      enabled: true,
      project_id: "repo/a",
    });
  });
});
