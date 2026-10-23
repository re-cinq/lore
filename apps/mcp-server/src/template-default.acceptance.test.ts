import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

describe("FR-3.3: The 'default' template includes all sources with sensible priorities", () => {
  it("includes sections for repo, adrs, memories, facts, and graph.", () => {
    const templateDir = join(import.meta.dirname, "..", "templates");
    expect(existsSync(join(templateDir, "default.yaml"))).toBe(true);
    const template = parseYaml(
      readFileSync(join(templateDir, "default.yaml"), "utf-8"),
    ) as { description: string; sections: { source: string }[] };
    expect(template.description).not.toBe("Fallback template");
    expect(template.sections.map((s) => s.source)).toMatchObject(
      expect.arrayContaining(["repo", "adrs", "memories", "facts", "graph"]),
    );
  });
});
