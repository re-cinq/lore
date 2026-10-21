import { describe, it, expect } from "vitest";
import { PgSkillDefs } from "./skill-defs-pg.js";

type Row = Record<string, unknown>;

function fakePool(rows: Row[]): any {
  return {
    query: async () => ({ rows }),
  };
}

describe("PgSkillDefs", () => {
  it("returns null when no skill of that name exists", async () => {
    const store = new PgSkillDefs(fakePool([]));

    expect(await store.resolve("re-cinq/lore", "nope")).toBeNull();
  });

  it("returns the org row as-is when no project override exists", async () => {
    const orgRow: Row = {
      name: "tdd-loop",
      title: "Org TDD",
      description: "Org description",
      model: "claude-sonnet",
      content: "Org content",
      enabled: true,
      project_id: null,
    };
    const store = new PgSkillDefs(fakePool([orgRow]));
    const result = await store.resolve("re-cinq/lore", "tdd-loop");

    expect(result).toMatchObject({
      name: "tdd-loop",
      title: "Org TDD",
      model: "claude-sonnet",
      project_id: null,
    });
  });
});
