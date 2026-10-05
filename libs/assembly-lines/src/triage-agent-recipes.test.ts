// specs/issue-triage/spec.md FR12
import { describe, it, expect } from "vitest";
import { loadAgentDefaults } from "@re-cinq/lore-shared/project/agents/agent-defaults-files.js";

function recipe(name: string) {
  return loadAgentDefaults().find((def) => def.name === name);
}

describe("triage agent recipes (specs/issue-triage/spec.md FR12)", () => {
  it("triage-reproduce, triage-diagnose, and triage-verify exist with non-empty prompts and correct timeout_minutes", () => {
    const reproduce = recipe("triage-reproduce");
    const diagnose = recipe("triage-diagnose");
    const verify = recipe("triage-verify");

    expect({
      reproduceDefined: !!reproduce,
      reproduceTimeout: reproduce?.timeout_minutes,
      reproduceHasPrompt: (reproduce?.prompt?.length ?? 0) > 0,
      diagnoseDefined: !!diagnose,
      diagnoseTimeout: diagnose?.timeout_minutes,
      diagnoseHasPrompt: (diagnose?.prompt?.length ?? 0) > 0,
      verifyDefined: !!verify,
      verifyTimeout: verify?.timeout_minutes,
      verifyHasPrompt: (verify?.prompt?.length ?? 0) > 0,
    }).toEqual({
      reproduceDefined: true,
      reproduceTimeout: 15,
      reproduceHasPrompt: true,
      diagnoseDefined: true,
      diagnoseTimeout: 10,
      diagnoseHasPrompt: true,
      verifyDefined: true,
      verifyTimeout: 10,
      verifyHasPrompt: true,
    });
  });

  it("each recipe documents every LORE_NODE_RESULT outcome it can emit", () => {
    const reproduce = recipe("triage-reproduce")?.prompt ?? "";
    const diagnose = recipe("triage-diagnose")?.prompt ?? "";
    const verify = recipe("triage-verify")?.prompt ?? "";

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
        notActionable: verify.includes("LORE_NODE_RESULT: not-actionable"),
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
        notActionable: true,
      },
    });
  });
});
