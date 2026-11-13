import { describe, it, expect, afterEach, vi } from "vitest";
import type { SkillDefinition } from "@re-cinq/lore-shared/models/skill-definition.js";
import { enabledSkillNamed, readCatalogue } from "./catalogue-skills.js";

function skill(name: string): SkillDefinition {
  return {
    name,
    title: name,
    description: "",
    model: null,
    content: `# ${name}`,
    enabled: true,
    projectId: null,
  };
}

describe("enabledSkillNamed", () => {
  it("finds cli-design among cli-design and tdd-loop", () => {
    expect(
      enabledSkillNamed([skill("tdd-loop"), skill("cli-design")], "cli-design"),
    ).toEqual(skill("cli-design"));
  });

  it("finds nothing for the disabled cli-design", () => {
    expect(
      enabledSkillNamed(
        [{ ...skill("cli-design"), enabled: false }],
        "cli-design",
      ),
    ).toBeUndefined();
  });
});

describe("readCatalogue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers null when this process has no LORE_API_URL", async () => {
    vi.stubEnv("LORE_API_URL", "");

    expect(await readCatalogue()).toBeNull();
  });
});
