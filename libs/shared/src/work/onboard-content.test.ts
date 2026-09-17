import { describe, it, expect } from "vitest";

import { LORE_TESTS_INSTRUCTION } from "../lib/lore-tests-instruction.js";
import {
  ONBOARD_STATIC_FILES,
  ONBOARD_FILES,
  ADR_TOPICS,
  TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
  ONBOARD_INSTRUCTED_WORKFLOWS,
  onboardTicketBody,
  onboardUpdateTicketBody,
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

describe("ONBOARD_STATIC_FILES ownership", () => {
  it("owns the three lore issue templates as lore files and leaves .claude/settings.json and config.yml to the repo", () => {
    expect(
      Object.fromEntries(
        ONBOARD_STATIC_FILES.map((file) => [file.path, file.owner]),
      ),
    ).toEqual({
      ".claude/settings.json": "repo",
      ".github/ISSUE_TEMPLATE/lore-implementation.yml": "lore",
      ".github/ISSUE_TEMPLATE/lore-review.yml": "lore",
      ".github/ISSUE_TEMPLATE/lore-general.yml": "lore",
      ".github/ISSUE_TEMPLATE/config.yml": "repo",
    });
  });
});

describe("onboardUpdateTicketBody", () => {
  const body = onboardUpdateTicketBody("re-cinq/app");
  const missingFrom = (fragments: string[]) =>
    fragments.filter((fragment) => !body.includes(fragment));

  it("asks to update re-cinq/app's Lore setup rather than onboard it", () => {
    expect(body).toContain(
      "Update re-cinq/app's Lore setup to the current requirements",
    );
    expect(body).not.toContain("Onboard re-cinq/app into Lore");
  });

  it("owes every file a first onboarding owes, each only when missing", () => {
    expect(
      missingFrom([
        "Add each of these files that does not exist yet",
        ...ONBOARD_FILES.map((file) => file.prompt),
        TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
        LORE_TESTS_INSTRUCTION,
      ]),
    ).toEqual([]);
  });

  it("realigns only lore-tests.yml and pr-description-check.yml, the workflows written from a Lore instruction", () => {
    expect(ONBOARD_INSTRUCTED_WORKFLOWS).toEqual([
      ".github/workflows/lore-tests.yml",
      ".github/workflows/pr-description-check.yml",
    ]);
    expect(body).toContain("Realign these workflows");
  });

  it("calls an already-current setup a success, not a failure", () => {
    expect(body).toContain(
      "a setup that is already current is a success, not a failure",
    );
  });
});
