import { describe, expect, it } from "vitest";
import {
  loadSkillDefaults,
  SHIPPED_SKILLS_DIR,
} from "./skill-defaults-files.js";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAgentDefaultFile } from "../domain/agent-defaults/agent-default-file.js";
import { hasValidHelpBlock } from "./skill-help-block.js";
import {
  attributionFactsOf,
  attributionSectionOf,
  hasCompleteAttribution,
} from "./skill-attribution.js";
import {
  referencedMarkdownFiles,
  referencedSkillNames,
} from "./skill-references.js";

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

const CONVENTIONAL_REPO_FILES = [
  "SKILL.md",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "THIRD_PARTY_NOTICES.md",
  "CONTEXT.md",
];
const FILES_A_SKILL_HAS_THE_READER_CREATE = ["characterization_test_plan.md"];

const UNSHIPPED_SKILL_NAMES = [
  "codebase-design",
  "reduce-system-complexity",
  "evaluate-existing-solutions",
  "ci-debugging",
  "production-parity-skill-builder",
  "acceptance-testing",
  "grill-me",
  "core-web-vitals",
  "story-splitting",
  "find-gaps",
  "double-check",
  "secure-oauth-oidc",
  "finding-seams",
  "characterisation-tests",
];
const UNSHIPPED_PLAIN_WORD_SKILL_NAMES = [
  "planning",
  "diagrams",
  "refactoring",
  "performance",
  "specification",
  "tdd",
  "adr",
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

  it("returns skills that only name markdown files a repo conventionally holds or the skill has the reader create", () => {
    const allowed = new Set([
      ...CONVENTIONAL_REPO_FILES,
      ...FILES_A_SKILL_HAS_THE_READER_CREATE,
    ]);
    const unshippedFiles = skills.flatMap((skill) =>
      referencedMarkdownFiles(skill.content)
        .filter((file) => !allowed.has(file))
        .map((file) => `${skill.name} -> ${file}`),
    );

    expect(unshippedFiles).toEqual([]);
  });

  it("returns skills that never mention a skill that exists in no catalogue", () => {
    const named = [
      ...UNSHIPPED_SKILL_NAMES.map((name) => new RegExp(`\\b${name}\\b`)),
      ...UNSHIPPED_PLAIN_WORD_SKILL_NAMES.map(
        (name) => new RegExp(`\`${name}\``),
      ),
    ];
    const offenders = skills.flatMap((skill) =>
      named
        .filter((pattern) => pattern.test(skill.content))
        .map((pattern) => `${skill.name} -> ${pattern.source}`),
    );

    expect(offenders).toEqual([]);
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

const RECINQ_ORIGINAL_SKILLS = [
  "check-tests",
  "legacy-add-tests",
  "legacy-find-missing-tests",
  "tdd-loop",
  "tdd-start",
];
const THIRD_PARTY_NOTICES = readFileSync(
  fileURLToPath(new URL("../../../../THIRD_PARTY_NOTICES.md", import.meta.url)),
  "utf-8",
);

describe("skill attribution", () => {
  const skills = loadSkillDefaults();
  const attributed = skills.filter(
    (skill) => !RECINQ_ORIGINAL_SKILLS.includes(skill.name),
  );

  it("returns 17 skills that are attributed to an upstream", () => {
    expect(attributed.map((skill) => skill.name)).toEqual([
      "api-design",
      "cli-design",
      "domain-driven-design",
      "event-sourcing",
      "front-end-testing",
      "functional",
      "hexagonal-architecture",
      "improve-codebase-architecture",
      "mutation-testing",
      "observability",
      "react-testing",
      "structure-codebase",
      "test-design-reviewer",
      "testing",
      "twelve-factor",
      "typescript-strict",
      "ubiquitous-language",
    ]);
  });

  it("returns attributed skills that all carry a source url, a credit line, a licence id and a modification statement in an Attribution section before Help", () => {
    const incomplete = attributed
      .filter((skill) => !hasCompleteAttribution(skill.content))
      .map((skill) => skill.name);

    expect(incomplete).toEqual([]);
  });

  it("returns a notices file that names every attributed skill file", () => {
    const missing = attributed
      .map((skill) => `libs/shared/src/agent-defaults/skills/${skill.name}.md`)
      .filter((path) => !THIRD_PARTY_NOTICES.includes(path));

    expect(missing).toEqual([]);
  });

  it("returns a notices file that holds every credit line the skills carry", () => {
    const creditLines = attributed.flatMap(
      (skill) =>
        attributionFactsOf(attributionSectionOf(skill.content) ?? "")
          .creditLines,
    );

    expect(
      [...new Set(creditLines)].filter(
        (line) => !THIRD_PARTY_NOTICES.includes(line),
      ),
    ).toEqual([]);
  });

  it("returns no Attribution section for the skills re:cinq wrote itself", () => {
    expect(
      skills
        .filter((skill) => RECINQ_ORIGINAL_SKILLS.includes(skill.name))
        .filter((skill) => skill.content.includes("## Attribution"))
        .map((skill) => skill.name),
    ).toEqual([]);
  });
});
