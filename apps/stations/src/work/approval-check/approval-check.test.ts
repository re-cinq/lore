import { describe, it, expect } from "vitest";
import { runApprovalCheck } from "./approval-check.js";
import type { StationHost, StationRepo } from "../lib/station.js";

function repo(labels: string[]): StationRepo & {
  status: Array<{ id: string; to: string }>;
  removed: string[];
  comments: number[];
} {
  const status: Array<{ id: string; to: string }> = [];
  const removed: string[] = [];
  const comments: number[] = [];

  return {
    status,
    removed,
    comments,
    async labelsOn() {
      return labels;
    },
    async approve(id) {
      status.push({ id, to: "pending" });
    },
    async removeLabel(issue) {
      removed.push(String(issue));
    },
    async comment(issue) {
      comments.push(issue);
    },
  };
}

const deps = (
  tasks: Array<{ id: string; target_repo: string; issue_number: number }>,
  repos: Record<string, ReturnType<typeof repo>>,
  label = "approved",
): StationHost =>
  ({
    awaitingApproval: async () => tasks,
    approvalLabel: () => label,
    repoFor: async (name: string) => repos[name],
  }) as unknown as StationHost;

const TASK = { id: "t-1", target_repo: "o/r", issue_number: 7 };

describe("runApprovalCheck", () => {
  it("reports nothing to do when no task is waiting", async () => {
    expect(await runApprovalCheck(deps([], {}))).toBe(
      "Checked 0 tasks, 0 approved",
    );
  });

  it("moves a task to pending once the approval label is on its issue", async () => {
    const r = repo(["approved"]);

    await runApprovalCheck(deps([TASK], { "o/r": r }));

    expect(r.status).toEqual([{ id: "t-1", to: "pending" }]);
  });

  it("leaves a task waiting while its issue carries no approval label", async () => {
    const r = repo(["needs-review"]);

    const summary = await runApprovalCheck(deps([TASK], { "o/r": r }));

    expect(r.status).toEqual([]);
    expect(summary).toBe("Checked 1 tasks, 0 approved");
  });

  it("honours the configured label rather than a hardcoded one", async () => {
    const r = repo(["ship-it"]);

    await runApprovalCheck(deps([TASK], { "o/r": r }, "ship-it"));

    expect(r.status).toEqual([{ id: "t-1", to: "pending" }]);
  });

  it("clears the waiting label and says so on the issue once approved", async () => {
    const r = repo(["approved"]);

    await runApprovalCheck(deps([TASK], { "o/r": r }));

    expect(r.removed).toEqual(["7"]);
    expect(r.comments).toEqual([7]);
  });

  it("keeps sweeping when one repo fails, so a single bad repo cannot stall the rest", async () => {
    const ok = repo(["approved"]);
    const broken: StationRepo = {
      async labelsOn() {
        throw new Error("github is down");
      },
      async approve() {},
      async removeLabel() {},
      async comment() {},
    };

    const summary = await runApprovalCheck({
      awaitingApproval: async () => [
        { id: "t-bad", target_repo: "o/bad", issue_number: 1 },
        TASK,
      ],
      approvalLabel: () => "approved",
      repoFor: async (name: string) => (name === "o/bad" ? broken : ok),
    } as unknown as StationHost);

    expect(ok.status).toEqual([{ id: "t-1", to: "pending" }]);
    expect(summary).toBe("Checked 2 tasks, 1 approved");
  });
});
