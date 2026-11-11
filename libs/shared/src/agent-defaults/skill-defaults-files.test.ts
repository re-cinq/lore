import { describe, expect, it } from "vitest";
import {
  loadSkillDefaults,
  SHIPPED_SKILLS_DIR,
} from "./skill-defaults-files.js";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAgentDefaultFile } from "../domain/agent-defaults/agent-default-file.js";
import { hasValidHelpBlock } from "./skill-help-block.js";
import { referencedSkillNames } from "./skill-references.js";

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

const GATEWAY_BAKED_SKILL_NAMES = [
  "lore-context",
  "tdd-loop",
  "legacy-characterize",
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

  it("returns skills that never mention resources/", () => {
    expect(
      skills
        .filter((skill) => skill.content.includes("resources/"))
        .map((skill) => skill.name),
    ).toEqual([]);
  });

  it("returns skills that only name shipped or gateway-baked skills", () => {
    const existing = new Set([
      ...SHIPPED_SKILL_NAMES,
      ...GATEWAY_BAKED_SKILL_NAMES,
    ]);
    const unknownReferences = skills.flatMap((skill) =>
      referencedSkillNames(skill.content)
        .filter((name) => !existing.has(name))
        .map((name) => `${skill.name} -> ${name}`),
    );

    expect(unknownReferences).toEqual([]);
  });

  it("returns agent files whose config.skills name only shipped or gateway-baked skills", () => {
    const existing = new Set([
      ...SHIPPED_SKILL_NAMES,
      ...GATEWAY_BAKED_SKILL_NAMES,
    ]);
    const unknownSkills = shippedAgentFiles().flatMap((file) =>
      skillsNamedBy(file.written)
        .filter((name) => !existing.has(name))
        .map((name) => `${file.name} -> ${name}`),
    );

    expect(unknownSkills).toEqual([]);
  });
});

function skillsNamedBy(written: Record<string, unknown>): string[] {
  const config = written.config as { skills?: string[] } | undefined;

  return config?.skills ?? [];
}

function shippedAgentFiles() {
  const dir = fileURLToPath(new URL("./", import.meta.url));

  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) =>
      readAgentDefaultFile(
        file.replace(/\.md$/, ""),
        readFileSync(`${dir}${file}`, "utf-8"),
      ),
    );
}
