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

  it("names the ingest token, the binary host var, and the ci-tests post host var", () => {
    expect(LORE_TESTS_INSTRUCTION).toContain("LORE_INGEST_TOKEN");
    expect(LORE_TESTS_INSTRUCTION).toContain("LORE_INGEST_URL");
    expect(LORE_TESTS_INSTRUCTION).toContain("LORE_WEBHOOK_URL");
  });
});
