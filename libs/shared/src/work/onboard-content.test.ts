import { describe, it, expect } from "vitest";

import { LORE_TESTS_INSTRUCTION } from "../lib/lore-tests-instruction.js";
import {
  ONBOARD_STATIC_FILES,
  ONBOARD_FILES,
  ADR_TOPICS,
  TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
  onboardTicketBody,
} from "./onboard-content.js";

const staticPaths = ONBOARD_STATIC_FILES.map((f) => f.path);
const llmPaths = ONBOARD_FILES.map((f) => f.path);
const allPaths = [...staticPaths, ...llmPaths];

describe("ONBOARD_STATIC_FILES", () => {
  it("commits .claude/settings.json carrying the Lore MCP system-prompt suffix", () => {
    const settings = ONBOARD_STATIC_FILES.find(
      (f) => f.path === ".claude/settings.json",
    );
    const suffix = JSON.parse(settings?.content ?? "{}").systemPromptSuffix;

    expect(suffix).toContain("Lore MCP server");
    expect(suffix).toContain("get_context");
  });

  it("commits the four .github/ISSUE_TEMPLATE task templates verbatim", () => {
    expect(staticPaths).toEqual(
      expect.arrayContaining([
        ".github/ISSUE_TEMPLATE/lore-implementation.yml",
        ".github/ISSUE_TEMPLATE/lore-review.yml",
        ".github/ISSUE_TEMPLATE/lore-general.yml",
        ".github/ISSUE_TEMPLATE/config.yml",
      ]),
    );
  });
});

describe("ONBOARD_FILES", () => {
  it("LLM-drafts AGENTS.md from a non-empty prompt", () => {
    const agents = ONBOARD_FILES.find((f) => f.path === "AGENTS.md");

    expect(agents?.prompt).toContain("AGENTS.md");
    expect(agents?.prompt.length ?? 0).toBeGreaterThan(20);
  });

  it("PR-template prompt names the five canonical sections", () => {
    const template = ONBOARD_FILES.find(
      (f) => f.path === ".github/PULL_REQUEST_TEMPLATE.md",
    );

    for (const section of [
      "## Why",
      "## What Changed",
      "## Alternatives Considered",
      "## ADRs & Architecture",
      "## Testing",
    ]) {
      expect(template?.prompt).toContain(section);
    }
  });

  it("LLM-drafts the pr-description-check workflow and the .specify spec", () => {
    expect(llmPaths).toEqual(
      expect.arrayContaining([
        ".github/workflows/pr-description-check.yml",
        ".specify/spec.md",
      ]),
    );
  });
});

describe("onboarding file-set boundaries", () => {
  it("scaffolds no CLAUDE.md, requested in the onboarding issue instead", () => {
    expect(allPaths.some((p) => p.endsWith("CLAUDE.md"))).toBe(false);
  });

  it("scaffolds no spec-agent.yml", () => {
    expect(allPaths.some((p) => p.includes("spec-agent"))).toBe(false);
  });
});

describe("onboardTicketBody", () => {
  const body = onboardTicketBody("re-cinq/app");
  const missingFrom = (fragments: string[]) =>
    fragments.filter((fragment) => !body.includes(fragment));

  it("names re-cinq/app as the repository being onboarded", () => {
    expect(body).toContain("Onboard re-cinq/app into Lore");
  });

  it("owes every LLM-drafted path with its prompt", () => {
    expect(
      missingFrom(
        ONBOARD_FILES.flatMap((file) => [`\`${file.path}\``, file.prompt]),
      ),
    ).toEqual([]);
  });

  it("owes the starter ADRs only for a repo with no adrs/ or docs/ directory", () => {
    expect(
      missingFrom([
        "adrs/ADR-001-language-choice.md",
        "adrs/ADR-003-deployment.md",
        "no `adrs/` or `docs/` directory",
        ...ADR_TOPICS.map((adr) => adr.prompt),
      ]),
    ).toEqual([]);
  });

  it("owes the test-command manifest and lore-tests.yml with their own instructions, only when absent", () => {
    expect(
      missingFrom([
        "`.lore/test-commands.yml`",
        TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
        "`.github/workflows/lore-tests.yml`",
        LORE_TESTS_INSTRUCTION,
      ]),
    ).toEqual([]);
  });

  it("says the deterministic scaffolding is already on the branch and must not be rewritten", () => {
    expect(
      missingFrom([
        ".github/workflows/lore-ingest.yml",
        ".github/ISSUE_TEMPLATE",
        "already committed",
      ]),
    ).toEqual([]);
  });

  it("forbids CLAUDE.md, existing-file rewrites and code changes, and leaves the pull request to Lore", () => {
    expect(
      missingFrom([
        "Do not author `CLAUDE.md`",
        "left untouched",
        "Change no source code",
        "Lore opens the pull request",
      ]),
    ).toEqual([]);
  });
});
