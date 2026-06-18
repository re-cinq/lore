import { describe, it, expect } from "vitest";
import { DECOMPOSITION_INSTRUCTIONS, DECOMPOSITION_EXAMPLE } from "./decomposition-instructions.js";
import { parseDecomposition } from "./decomposition-result.js";

describe("DECOMPOSITION_INSTRUCTIONS", () => {
  it("documents the output contract — stories, acceptance criteria, and task dependencies", () => {
    for (const token of ["stories", "acceptance_criteria", "depends_on", "tasks"]) {
      expect(DECOMPOSITION_INSTRUCTIONS).toContain(token);
    }
  });

  it("frames decomposition as turning the spec into work, not re-planning it", () => {
    expect(DECOMPOSITION_INSTRUCTIONS).toMatch(/user stor/i);
    expect(DECOMPOSITION_INSTRUCTIONS).toMatch(/take the spec as settled/i);
  });
});

describe("DECOMPOSITION_EXAMPLE", () => {
  it("parses cleanly through parseDecomposition", () => {
    const parsed = parseDecomposition(JSON.parse(DECOMPOSITION_EXAMPLE));
    expect(parsed.stories.length).toBeGreaterThan(0);
    expect(parsed.stories[0].tasks.length).toBeGreaterThan(0);
  });

  it("shows a cross-task dependency so the model learns to wire phases", () => {
    const parsed = parseDecomposition(JSON.parse(DECOMPOSITION_EXAMPLE));
    const everyTask = parsed.stories.flatMap((s) => s.tasks);
    expect(everyTask.some((t) => t.depends_on.length > 0)).toBe(true);
  });
});
