import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadTemplates,
  getTemplate,
} from "@re-cinq/lore-shared/outbound/project/knowledge/context-assembly-templates.js";

// specs/context-assembly/spec.md#FR-3.3
describe("default template file", () => {
  const templateDir = join(import.meta.dirname, "..", "templates");

  it("exists at apps/mcp-server/templates/default.yaml", () => {
    expect(existsSync(join(templateDir, "default.yaml"))).toBe(true);
  });

  it("includes a facts section source", () => {
    loadTemplates(templateDir);
    const template = getTemplate("default");
    const sources = template.sections.map((s) => s.source as string);
    expect(sources).toContain("facts");
  });
});
