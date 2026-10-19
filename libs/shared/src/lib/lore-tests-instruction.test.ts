import { describe, it, expect } from "vitest";
import { LORE_TESTS_INSTRUCTION } from "./lore-tests-instruction.js";

describe("LORE_TESTS_INSTRUCTION", () => {
  it("is a non-empty string", () => {
    expect(typeof LORE_TESTS_INSTRUCTION).toBe("string");
    expect(LORE_TESTS_INSTRUCTION.length).toBeGreaterThan(0);
  });

  it("names no concrete language or test runner", () => {
    const languageOrRunner =
      /\b(python|pytest|ruby|rspec|golang|go test|cargo|rust|npm|yarn|pnpm|vitest|jest|mocha|junit|gradle|maven|phpunit|dotnet|java(script)?|typescript)\b/i;

    expect(LORE_TESTS_INSTRUCTION).not.toMatch(languageOrRunner);
  });

  it("instructs running on both push and pull_request", () => {
    expect(LORE_TESTS_INSTRUCTION).toMatch(/\bpush\b/);
    expect(LORE_TESTS_INSTRUCTION).toMatch(/\bpull_request\b/);
  });

  it("instructs downloading and running the lore-code-trace orchestrator binary", () => {
    expect(LORE_TESTS_INSTRUCTION).toContain("/dist/lore-code-trace/");
    expect(LORE_TESTS_INSTRUCTION).toContain("lore-code-trace --post");
  });

  it("instructs running the .lore/test-commands.yml commands", () => {
    expect(LORE_TESTS_INSTRUCTION).toContain(".lore/test-commands.yml");
  });

  it("instructs one subdir-scoped job per detected toolchain for monorepos", () => {
    expect(LORE_TESTS_INSTRUCTION).toMatch(/per detected test toolchain/i);
    expect(LORE_TESTS_INSTRUCTION).toContain("working-directory");
  });

  it("passes LORE_API_URL bound the way lore-ingest.yml binds its URL, and the ingest token, never the unset LORE_WEBHOOK_URL (#1203)", () => {
    expect(
      [
        "LORE_API_URL: ${{ secrets.LORE_INGEST_URL || vars.LORE_INGEST_URL || vars.LORE_API_URL }}",
        "LORE_INGEST_TOKEN: ${{ secrets.LORE_INGEST_TOKEN }}",
        "Do not pass `LORE_WEBHOOK_URL`",
      ].filter((fragment) => !LORE_TESTS_INSTRUCTION.includes(fragment)),
    ).toEqual([]);
    expect(LORE_TESTS_INSTRUCTION).not.toContain("vars.LORE_WEBHOOK_URL");
  });

  it("checks out full history so the orchestrator can diff against the last ingested commit", () => {
    expect(LORE_TESTS_INSTRUCTION).toContain("fetch-depth: 0");
  });
});
