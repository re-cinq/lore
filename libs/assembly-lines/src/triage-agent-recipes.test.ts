import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-files.js";

function recipe(name: string) {
  return loadAgentDefaults().find((def) => def.name === name);
}

function promptFor(name: string): string {
  return recipe(name)?.prompt ?? "";
}

describe("triage agent recipes (specs/issue-triage/spec.md FR12)", () => {
  it("triage-reproduce, triage-diagnose, and triage-verify exist with non-empty prompts and correct timeout_minutes", () => {
    const reproduce = recipe("triage-reproduce");
    const diagnose = recipe("triage-diagnose");
    const verify = recipe("triage-verify");

    expect(reproduce).toBeDefined();
    expect(reproduce!.timeout_minutes).toBe(15);
    expect(reproduce!.prompt).toBeTruthy();
    expect(diagnose).toBeDefined();
    expect(diagnose!.timeout_minutes).toBe(10);
    expect(diagnose!.prompt).toBeTruthy();
    expect(verify).toBeDefined();
    expect(verify!.timeout_minutes).toBe(10);
    expect(verify!.prompt).toBeTruthy();
  });

  it("each recipe documents every LORE_NODE_RESULT outcome it can emit", () => {
    const reproduce = promptFor("triage-reproduce");
    const diagnose = promptFor("triage-diagnose");
    const verify = promptFor("triage-verify");

    expect({
      reproduce: {
        success: reproduce.includes("LORE_NODE_RESULT: success"),
        unableToReproduce: reproduce.includes(
          "LORE_NODE_RESULT: unable-to-reproduce",
        ),
        needsReproduction: reproduce.includes(
          "LORE_NODE_RESULT: needs-reproduction",
        ),
        skipped: reproduce.includes("LORE_NODE_RESULT: skipped"),
      },
      diagnose: {
        success: diagnose.includes("LORE_NODE_RESULT: success"),
        failed: diagnose.includes("LORE_NODE_RESULT: failed"),
      },
      verify: {
        success: verify.includes("LORE_NODE_RESULT: success"),
        obsolete: verify.includes("LORE_NODE_RESULT: obsolete"),
        largeIssue: verify.includes("LORE_NODE_RESULT: large-issue"),
        actionable: !verify.includes("LORE_NODE_RESULT: not-actionable"),
      },
    }).toEqual({
      reproduce: {
        success: true,
        unableToReproduce: true,
        needsReproduction: true,
        skipped: true,
      },
      diagnose: {
        success: true,
        failed: true,
      },
      verify: {
        success: true,
        obsolete: true,
        largeIssue: true,
        actionable: false,
      },
    });
  });
});
