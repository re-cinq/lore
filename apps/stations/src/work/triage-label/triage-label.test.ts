import { describe, it, expect } from "vitest";
import { runTriageLabelStation } from "./triage-label.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

function input(params: Record<string, string>): StationInput {
  return {
    assembly_run_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    node_id: "triage-label",
    node_type: "triage-label",
    repo: "re-cinq/lore",
    branch: "lore/test",
    task_id: "task-1",
    params,
  };
}

function fakeProject() {
  const calls: Array<{ number: number; label: string }> = [];

  return {
    calls,
    project: {
      issues: {
        addLabel: async (number: number, label: string) => {
          calls.push({ number, label });
        },
      },
    } as never,
  };
}

describe("runTriageLabelStation", () => {
  it("maps each triage outcome to the correct triage:* label and calls addLabel with the issue number", async () => {
    const MAPPING: Array<[string, string]> = [
      ["reproduced", "triage: reproduced"],
      ["unable-to-reproduce", "triage: unable-to-reproduce"],
      ["needs-reproduction", "triage: needs-reproduction"],
      ["diagnosed", "triage: diagnosed"],
      ["skipped", "triage: skipped"],
      ["not-actionable", "triage: not-actionable"],
      ["failed", "triage: failed"],
      ["needs-triage", "triage: needs-triage"],
    ];

    for (const [outcome, expectedLabel] of MAPPING) {
      const fake = fakeProject();

      const result = await runTriageLabelStation(
        input({ outcome, issue_number: "42" }),
        { project: fake.project },
      );

      expect(result.outcome).toBe("success");
      expect(fake.calls).toEqual([{ number: 42, label: expectedLabel }]);
    }
  });

  it("fails when addLabel throws, so the walk can route to a failure edge", async () => {
    const fake = {
      project: {
        issues: {
          addLabel: async () => {
            throw new Error("GitHub 503");
          },
        },
      } as never,
    };

    const result = await runTriageLabelStation(
      input({ outcome: "reproduced", issue_number: "42" }),
      { project: fake.project },
    );

    expect(result.outcome).toBe("failed");
  });
});
