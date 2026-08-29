import { describe, it, expect } from "vitest";
import { agentPrompt } from "./agent-invocation.js";

describe("agentPrompt", () => {
  it("substitutes {description} into the resolved agent's prompt", () => {
    expect(
      agentPrompt("Implement: {description}", "add health check", "FB"),
    ).toBe("Implement: add health check");
  });

  it("falls back to the yaml task-type template when the definition has no prompt", () => {
    expect(agentPrompt(null, "x", "yaml fallback")).toBe("yaml fallback");
    expect(agentPrompt("", "x", "yaml fallback")).toBe("yaml fallback");
  });
});

describe("a description carrying $-replacement patterns", () => {
  it("inserts $' and $& verbatim rather than expanding them", () => {
    // String.prototype.replace reads these in the REPLACEMENT: `$'` means "the
    // text after the match", so a description quoting a shell variable used to
    // splice the rest of the template back into itself.
    expect(
      agentPrompt(
        "Implement: {description}\nEnd.",
        "print $' and $& and $$",
        "",
      ),
    ).toBe("Implement: print $' and $& and $$\nEnd.");
  });
});
