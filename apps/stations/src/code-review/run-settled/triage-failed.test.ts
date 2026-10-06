// spec: specs/issue-triage/spec.md#FR18
import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import { runSettledHandle } from "./station.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const ISSUE_NUMBER = 42;
const ISSUE_URL = `https://github.com/re-cinq/lore/issues/${ISSUE_NUMBER}`;

function triageRun(outcome: string): RunView {
  return {
    id: "run-triage-1",
    lineId: "issue-triage",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: `issue_url:${ISSUE_URL}`,
    startItems: {
      issue_url: { kind: "value", ref: ISSUE_URL, by: "lore" },
      issue_number: { kind: "value", ref: String(ISSUE_NUMBER), by: "lore" },
    },
    createdAt: "2026-10-01T09:00:00.000Z",
    outcome,
    reason: "pod crashed",
    finishedAt: "2026-10-01T10:00:00.000Z",
  };
}

function scene(outcome: string) {
  const applied: Array<{ repo: string; issue: number; label: string }> = [];
  const deps = {
    run: () => Promise.resolve(triageRun(outcome)),
    failedAgentVisit: () => Promise.resolve(null),
    project: (_repo: string) =>
      Promise.reject(new Error("project not expected for issue-triage")),
    addLabel: (repo: string, issue: number, label: string) => {
      applied.push({ repo, issue, label });
      return Promise.resolve();
    },
  };

  return {
    settle: () =>
      runSettledHandle(deps as never)(
        {
          visitId: "v-1",
          iteration: 1,
          needs: {
            run_id: "run-triage-1",
            line_id: "issue-triage",
            outcome,
          },
        },
        TOOLS,
      ),
    applied,
  };
}

describe("triage: failed on a terminal issue-triage run", () => {
  it("applies triage: failed to the issue when the run ended without a verdict", async () => {
    const { settle, applied } = scene("failed");

    await settle();

    expect(applied).toContainEqual({
      repo: "re-cinq/lore",
      issue: ISSUE_NUMBER,
      label: "triage: failed",
    });
  });
});
