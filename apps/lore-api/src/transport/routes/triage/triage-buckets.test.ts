import { describe, expect, it } from "vitest";
import { triageBuckets } from "./triage-buckets.js";

const issue = (number: number, label?: string) => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/acme/widgets/issues/${number}`,
  labels: label ? [label] : [],
});

describe("triageBuckets", () => {
  it("puts #1 with an open run under current with its stages, #2 needs-triage in the backlog, #3 needs-priority under recent", () => {
    const buckets = triageBuckets(
      [
        issue(1, "triage: diagnosed"),
        issue(2, "triage: needs-triage"),
        issue(3, "triage: needs-priority"),
      ],
      [
        {
          id: "run-1",
          issueNumber: "1",
          pipeline: [{ node_id: "verify", state: "running" }],
        },
      ],
    );

    expect({
      current: buckets.current.map((r) => [r.issue_number, r.state, r.run_id]),
      stages: buckets.current[0].pipeline,
      backlog: buckets.backlog.map((r) => r.issue_number),
      recent: buckets.recent.map((r) => r.issue_number),
      parked: buckets.parked,
    }).toEqual({
      current: [[1, "diagnosed", "run-1"]],
      stages: [{ node_id: "verify", state: "running" }],
      backlog: [2],
      recent: [3],
      parked: [],
    });
  });

  it("parks needs-reproduction, failed and a diagnosed issue no run is working, and leaves out an issue with no triage label", () => {
    const buckets = triageBuckets(
      [
        issue(4, "triage: needs-reproduction"),
        issue(5, "triage: failed"),
        issue(6, "triage: diagnosed"),
        issue(7, "bug"),
      ],
      [],
    );

    expect(buckets.parked.map((r) => [r.issue_number, r.state])).toEqual([
      [4, "needs-reproduction"],
      [5, "failed"],
      [6, "diagnosed"],
    ]);
  });

  it("shows an unlabelled issue a run took up as triaging under current", () => {
    const buckets = triageBuckets(
      [{ number: 8, title: "Crash", labels: ["lore:triage"] }],
      [{ id: "run-8", issueNumber: "8", pipeline: [] }],
    );

    expect(buckets.current.map((r) => [r.issue_number, r.state])).toEqual([
      [8, "triaging"],
    ]);
  });
});
