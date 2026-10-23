import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

describe("default template file", () => {
  const templateDir = join(import.meta.dirname, "..", "templates");

  it("exists at apps/mcp-server/templates/default.yaml", () => {
    expect(existsSync(join(templateDir, "default.yaml"))).toBe(true);
  });

  it("includes a facts section source", () => {
    const raw = readFileSync(join(templateDir, "default.yaml"), "utf-8");
    const template = parseYaml(raw) as { sections: { source: string }[] };
    expect(template.sections.map((s) => s.source)).toContain("facts");
  });
});
