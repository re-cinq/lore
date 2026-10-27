import { describe, expect, it } from "vitest";
import {
  loadSkillDefaults,
  SHIPPED_SKILLS_DIR,
} from "./skill-defaults-files.js";
import { hasValidHelpBlock } from "./skill-help-block.js";

const SHIPPED_SKILL_NAMES = [
  "api-design",
  "check-tests",
  "cli-design",
  "domain-driven-design",
  "event-sourcing",
  "front-end-testing",
  "functional",
  "hexagonal-architecture",
  "improve-codebase-architecture",
  "legacy-add-tests",
  "legacy-find-missing-tests",
  "mutation-testing",
  "observability",
  "react-testing",
  "structure-codebase",
  "tdd-loop",
  "tdd-start",
  "test-design-reviewer",
  "testing",
  "twelve-factor",
  "typescript-strict",
  "ubiquitous-language",
];

describe("loadSkillDefaults", () => {
  const skills = loadSkillDefaults();

  it("returns the 22 shipped skill names sorted", () => {
    expect(skills.map((skill) => skill.name)).toEqual(SHIPPED_SKILL_NAMES);
  });

  it("returns skills that all carry a valid Help block", () => {
    expect(skills.filter((skill) => !hasValidHelpBlock(skill.content))).toEqual(
      [],
    );
  });

  it("returns skills whose content starts with their frontmatter name", () => {
    expect(
      skills.filter(
        (skill) => !skill.content.startsWith(`---\nname: ${skill.name}\n`),
      ),
    ).toEqual([]);
  });

  it("reads the skills from inside libs/shared, never apps/mcp-server", () => {
    expect(SHIPPED_SKILLS_DIR).toMatch(/libs\/shared\/.*\/skills\/$/);
    expect(SHIPPED_SKILLS_DIR).not.toContain("apps/mcp-server");
  });
});
