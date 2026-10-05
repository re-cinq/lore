// specs/issue-triage/spec.md#86 (FR7) and #87 (FR8)

import { describe, it, expect } from "vitest";
import {
  createLabeledIssueHandler,
  type LabeledIssueDeps,
} from "./repo-handlers.js";

type StartCall = { blueprintName: string; args: Record<string, unknown> };
type ReportTarget = { lineId: string; nodeId: string; iteration: number };

const testIssue = (number: number) => ({
  number,
  title: `Issue ${number}`,
  body: "body text",
  html_url: `https://github.com/acme/widgets/issues/${number}`,
  labels: [] as string[],
});

function makeDeps(overrides: Partial<LabeledIssueDeps> = {}): {
  deps: LabeledIssueDeps;
  started: StartCall[];
  reported: ReportTarget[];
  activeCalls: string[];
} {
  const started: StartCall[] = [];
  const reported: ReportTarget[] = [];
  const activeCalls: string[] = [];

  const base: LabeledIssueDeps = {
    startLine: async (blueprintName, opts) => {
      started.push({ blueprintName, args: opts.args });
      return "run-abc123";
    },
    findParkedTriage: async (_repo, _issueNumber) => null,
    reportToVisit: async (target, _outcome) => {
      reported.push(target);
    },
    activeTaskByIssue: async (_repo, _issueNumber) => {
      activeCalls.push("activeTaskByIssue");
      return null;
    },
    dispatchImplementation: async (_repo, _issue) => {},
  };

  return { deps: { ...base, ...overrides }, started, reported, activeCalls };
}

describe("createLabeledIssueHandler", () => {
  it("lore:triage label starts an issue-triage floor run with repo, issue_url, and issue_number args", // specs/issue-triage/spec.md#86
  async () => {
    const { deps, started } = makeDeps();
    const handler = createLabeledIssueHandler(deps);
    const issue = testIssue(42);

    await handler({
      repo: "acme/widgets",
      label: "lore:triage",
      issue: { ...issue, labels: ["lore:triage"] },
    });

    expect(started).toHaveLength(1);
    expect(started[0].blueprintName).toBe("issue-triage");
    expect(started[0].args).toMatchObject({
      repo: "acme/widgets",
      issue_url: issue.html_url,
      issue_number: 42,
    });
  });

  it("triage: needs-triage label also starts an issue-triage floor run", // specs/issue-triage/spec.md#86
  async () => {
    const { deps, started } = makeDeps();
    const handler = createLabeledIssueHandler(deps);
    const issue = testIssue(7);

    await handler({
      repo: "acme/widgets",
      label: "triage: needs-triage",
      issue: { ...issue, labels: ["triage: needs-triage"] },
    });

    expect(started).toHaveLength(1);
    expect(started[0].blueprintName).toBe("issue-triage");
  });

  it("lore:implementation on a parked triage run resumes via reportToVisit before activeTaskByIssue fires", // specs/issue-triage/spec.md#87
  async () => {
    const callOrder: string[] = [];
    const parked: ReportTarget = {
      lineId: "line-001",
      nodeId: "human-gate",
      iteration: 1,
    };

    const { deps, reported, activeCalls } = makeDeps({
      findParkedTriage: async (_repo, _issueNumber) => {
        callOrder.push("findParked");
        return parked;
      },
      reportToVisit: async (target, _outcome) => {
        callOrder.push("reportToVisit");
        reported.push(target);
      },
      activeTaskByIssue: async (_repo, _issueNumber) => {
        callOrder.push("activeTaskByIssue");
        activeCalls.push("activeTaskByIssue");
        return null;
      },
    });

    const handler = createLabeledIssueHandler(deps);
    const issue = testIssue(99);

    await handler({
      repo: "acme/widgets",
      label: "lore:implementation",
      issue: { ...issue, labels: ["lore:implementation"] },
    });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      lineId: "line-001",
      nodeId: "human-gate",
      iteration: 1,
    });
    const reportIdx = callOrder.indexOf("reportToVisit");
    const activeIdx = callOrder.indexOf("activeTaskByIssue");

    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    expect(reportIdx).toBeLessThan(activeIdx);
  });
});
