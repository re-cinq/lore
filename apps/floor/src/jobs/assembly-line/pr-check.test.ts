import { describe, it, expect } from "vitest";
import { assemblyLineCheck } from "./pr-check.js";
import type { AssemblyLineRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";

function line(over: Partial<AssemblyLineRecord>): AssemblyLineRecord {
  return {
    id: "al-1",
    definitionName: "code-review",
    taskId: null,
    repo: "re-cinq/lore",
    branch: "feat/x",
    args: { pr_number: 7, head_sha: "abc123" },
    status: "running",
    outcome: null,
    reason: null,
    createdAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

describe("assemblyLineCheck", () => {
  it("returns null when the line carries no pr_number", () => {
    expect(assemblyLineCheck(line({ args: { head_sha: "abc" } }))).toBeNull();
  });

  it("returns null when the line carries no head_sha", () => {
    expect(assemblyLineCheck(line({ args: { pr_number: 7 } }))).toBeNull();
  });

  it("maps a running line to an in_progress check named lore/<definition>", () => {
    expect(assemblyLineCheck(line({ status: "running" }))).toMatchObject({
      headSha: "abc123",
      name: "lore/code-review",
      status: "in_progress",
    });
  });

  it("maps a changes_requested outcome to a neutral conclusion", () => {
    expect(
      assemblyLineCheck(
        line({ status: "finished", outcome: "changes_requested" }),
      ),
    ).toMatchObject({ status: "completed", conclusion: "neutral" });
  });

  it("maps a successful line to a success conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "success" })),
    ).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it("maps a failed line to a failure conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "failed", outcome: "error" })),
    ).toMatchObject({ status: "completed", conclusion: "failure" });
  });

  it("maps a pr_closed outcome to a cancelled conclusion", () => {
    expect(
      assemblyLineCheck(line({ status: "finished", outcome: "pr_closed" })),
    ).toMatchObject({ status: "completed", conclusion: "cancelled" });
  });

  it("adds a details_url to the Lore UI when a uiUrl is given", () => {
    expect(
      assemblyLineCheck(line({}), "https://lore.example.com"),
    ).toMatchObject({
      detailsUrl: "https://lore.example.com/assembly-lines/al-1",
    });
  });
});
