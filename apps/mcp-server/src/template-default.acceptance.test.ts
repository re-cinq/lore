import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  loadTemplates,
  getTemplate,
} from "@re-cinq/lore-shared/outbound/project/knowledge/context-assembly-templates.js";
import { existsSync } from "node:fs";

describe("FR-3.3: The 'default' template includes all sources with sensible priorities", () => {
  it("includes sections for repo, adrs, memories, facts, and graph.", () => {
    const templateDir = join(import.meta.dirname, "..", "templates");
    expect(existsSync(join(templateDir, "default.yaml"))).toBe(true);

    loadTemplates(templateDir);
    const template = getTemplate("default");

    expect(template.description).not.toBe("Fallback template");

    const sources = template.sections.map((s) => s.source as string);
    expect(sources).toContain("repo");
    expect(sources).toContain("adrs");
    expect(sources).toContain("memories");

    // The ticket explicitly states "facts" as a section source
    expect(sources).toContain("facts");
    expect(sources).toContain("graph");
  });
});
