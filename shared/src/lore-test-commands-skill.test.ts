import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TEST_COMMAND_SETUP_PROMPT } from "./test-command-setup-prompt.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsDir = join(repoRoot, ".claude", "skills");

describe("lore-test-commands skill", () => {
  it("carries the canonical TEST_COMMAND_SETUP_PROMPT verbatim", () => {
    if (!existsSync(skillsDir)) return;
    const skill = readFileSync(
      join(skillsDir, "lore-test-commands", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(TEST_COMMAND_SETUP_PROMPT);
  });
});
