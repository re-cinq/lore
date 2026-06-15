import { describe, it, expect } from "vitest";
import { TEST_COMMAND_SETUP_PROMPT } from "./test-command-setup-prompt.js";

describe("TEST_COMMAND_SETUP_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof TEST_COMMAND_SETUP_PROMPT).toBe("string");
    expect(TEST_COMMAND_SETUP_PROMPT.length).toBeGreaterThan(0);
  });

  it("names no concrete language or test runner", () => {
    const languageOrRunner =
      /\b(python|pytest|ruby|rspec|golang|go test|cargo|rust|npm|yarn|pnpm|vitest|jest|mocha|junit|gradle|maven|phpunit|dotnet|java(script)?|typescript)\b/i;
    expect(TEST_COMMAND_SETUP_PROMPT).not.toMatch(languageOrRunner);
  });
});
