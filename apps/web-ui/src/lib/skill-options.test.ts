import { describe, it, expect } from "vitest";
import { skillCatalogueOf } from "./skill-options";
import type { SkillDefinition } from "./skill-definition";

const CLI_DESIGN: SkillDefinition = {
  name: "cli-design",
  title: "CLI design",
  description: "",
  model: null,
  content: "",
  enabled: true,
  projectId: null,
};

const TDD_LOOP_OFF: SkillDefinition = {
  ...CLI_DESIGN,
  name: "tdd-loop",
  title: "TDD loop",
  enabled: false,
};

describe("skillCatalogueOf", () => {
  it("offers only the enabled skill cli-design out of cli-design and the disabled tdd-loop", () => {
    expect(
      skillCatalogueOf({ status: "ok", skills: [CLI_DESIGN, TDD_LOOP_OFF] }),
    ).toEqual({ options: [{ name: "cli-design", title: "CLI design" }] });
  });

  it("offers nothing and carries the message when the catalogue failed to load", () => {
    expect(
      skillCatalogueOf({ status: "failed", message: "lore-api unreachable" }),
    ).toEqual({ options: [], error: "lore-api unreachable" });
  });
});
