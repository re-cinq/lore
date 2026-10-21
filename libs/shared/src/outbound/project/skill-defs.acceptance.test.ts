import { describe, it, expect } from "vitest";

// We import the non-existent modules to assert they provide the requested functionality.
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
  // specs/org-skills/spec.md#FR-009
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
      description: null, // Should inherit from org
      model: "claude-opus", // Overrides org
      content: "Project content", // Overrides org
      enabled: true,
      project_id: "repo/a",
    };

    const pool = fakePool((text, params) => {
      // Return both rows when resolving
      return [projectRow, orgRow];
    });

    const defs = new PgSkillDefs(pool);
    const resolved = await defs.resolve("repo/a", "tdd-loop");

    expect(resolved).toEqual({
      name: "tdd-loop",
      title: "Project TDD",
      description: "Org description", // inherited
      model: "claude-opus", // overridden
      content: "Project content", // overridden
      enabled: true, // overridden / same
      project_id: "repo/a", // the winner's scope
    });
  });
});
