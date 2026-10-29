import { describe, expect, it, vi } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { IssueComment } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { TestReport } from "@re-cinq/lore-shared/models/test-report.js";
import { loadImplementationHandle } from "./load.js";
import { verifyIssueImplementationHandle } from "./verify.js";
import { closeIssueHandle } from "../close-issue/index.js";
import type { ImplementationDeps } from "./deps.js";

export const COMMIT = "a".repeat(40);
export const SOURCE = {
  path: "src/widget.ts",
  start: 1,
  end: 1,
  text: "renderWidget",
};
export const TEST_SOURCE =
  'it("renders widget", () => {\n  expect(renderWidget()).toEqual("widget");\n});\n';
export const PROOF = {
  line: 5 as const,
  test_id: "widget-case",
  evidence: {
    path: "src/widget.test.ts",
    start: 1,
    end: 3,
    text: 'expect(renderWidget()).toEqual("widget")',
  },
  reason: "The original widget rendering path produces the requested result",
};

export function assessment(
  status: "present" | "partial" | "missing" = "present",
) {
  const task = {
    id: "T001",
    description: "Fix widget",
    depends_on: [],
    parallelizable: false,
    phase: 1,
    spec_lines: { "issue-scope.md": [5] },
    ...(status === "partial"
      ? {
          context: "Existing rendering works; colour is absent",
          changes: "Add the missing colour prop",
          acceptance_criteria: ["Blue widgets render blue"],
          test_plan: "Exercise the blue rendering case",
          in_place: [{ file: "issue-scope.md", line: 5, ...SOURCE }],
          remaining: "The colour prop is missing",
        }
      : {}),
  };

  return {
    spec_commit: COMMIT,
    statements: [
      {
        file: "issue-scope.md",
        line: 5,
        status,
        evidence: status === "missing" ? [] : [{ ...SOURCE }],
      },
    ],
    stories: [{ title: "Widget", tasks: [task] }],
    behavioral_proof:
      status === "missing"
        ? []
        : [{ ...PROOF, evidence: { ...PROOF.evidence } }],
  };
}

export function scene(raw: object = assessment()) {
  const issue: IssueRef = {
    repo: "acme/widgets",
    number: 42,
    title: "Fix widget rendering",
    body: "Widgets must render correctly",
    state: "open",
    labels: ["bug", "priority:medium"],
  };
  const artifacts: Record<string, string> = {
    implementation_assessment: JSON.stringify(raw),
  };
  const files: Record<string, string> = {
    [SOURCE.path]: "export function renderWidget() {}\n",
    [PROOF.evidence.path]: TEST_SOURCE,
  };
  const comments: IssueComment[] = [];
  const calls: string[] = [];
  const report: TestReport = {
    id: "report-1",
    repo: issue.repo,
    commit: COMMIT,
    branch: "main",
    tests: [
      {
        id: PROOF.test_id,
        name: "renders widget",
        file: PROOF.evidence.path,
        startLine: 1,
      },
    ],
    outcomes: { [PROOF.test_id]: true },
    receivedAt: new Date("2026-10-29"),
  };
  const read = vi.fn(
    async (path: string, _commit?: string) => files[path] ?? null,
  );
  const close = vi.fn(async (_number: number, _reason?: string) => {
    calls.push("close");
    issue.state = "closed";
  });
  const update = vi.fn(
    async (_number: number, edit: { body?: string; title?: string }) => {
      calls.push("update");
      Object.assign(issue, edit);
    },
  );
  const project = {
    repo: {
      defaultBranch: async () => "main",
      headSha: vi.fn(async () => COMMIT),
      read,
    },
    issues: {
      get: async () => issue,
      update,
      close,
      listComments: async () => comments,
      comment: vi.fn(async (_number: number, body: string) => {
        calls.push("comment");
        comments.push({
          id: comments.length + 1,
          body,
          user: "lore",
          created_at: "2026-10-29",
        });
      }),
      addLabel: vi.fn(async (_number: number, label: string) => {
        issue.labels.push(label);
      }),
    },
  };
  const deps: ImplementationDeps = {
    project: async () => project,
    report: vi.fn(async () => report),
  };
  const tools: Tools = {
    read: async (name) => Buffer.from(artifacts[name]),
    produce: async (name, bytes) => {
      artifacts[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const brief = {
    visitId: "visit-1",
    iteration: 1,
    needs: { repo: issue.repo, issue_number: "42", verified_completion: "" },
  };
  const load = () => loadImplementationHandle(deps)(brief, tools);
  const verify = () => verifyIssueImplementationHandle(deps)(brief, tools);
  const finish = () =>
    closeIssueHandle(deps)(
      {
        ...brief,
        needs: {
          ...brief.needs,
          verified_completion: artifacts.verified_completion ? "proof" : "",
        },
      },
      tools,
    );

  return {
    issue,
    artifacts,
    files,
    comments,
    calls,
    report,
    read,
    project,
    deps,
    tools,
    brief,
    load,
    verify,
    finish,
  };
}

describe("issue implementation assessment", () => {
  it("closes bug 42 only after source and its recorded CI behavior pass at pinned main", async () => {
    const s = scene();

    const reports = [await s.load(), await s.verify(), await s.finish()];

    expect({ reports, objections: s.artifacts.implementation_report }).toEqual({
      reports: [
        { outcome: "success" },
        { outcome: "implemented" },
        { outcome: "success" },
      ],
      objections: "",
    });
    expect({
      calls: s.calls,
      state: s.issue.state,
      reason: s.project.issues.close.mock.calls,
    }).toEqual({
      calls: ["comment", "close"],
      state: "closed",
      reason: [[42, "completed"]],
    });
    expect(s.comments[0].body).toContain(
      `https://github.com/acme/widgets/blob/${COMMIT}/src/widget.test.ts#L1-L3`,
    );
  });

  it("assesses an ordinary feature request through the same evidence gate", async () => {
    const s = scene();

    s.issue.labels = ["enhancement"];
    expect([await s.load(), await s.verify(), await s.finish()]).toEqual([
      { outcome: "success" },
      { outcome: "implemented" },
      { outcome: "success" },
    ]);
  });

  it("retains all report text as one requirement instead of dropping unchecked reproduction cases", async () => {
    const s = scene();

    s.issue.body = "Case A passes.\n\n## Reproduction\nCase B still fails.";
    await s.load();
    expect(s.artifacts.issue_scope).toContain(
      "Case A passes.  ## Reproduction Case B still fails.",
    );
    expect(s.artifacts.issue_scope.split("\n")[4]).toContain(
      "The implementation MUST satisfy this entire issue report",
    );
  });

  it("narrows task 42 to the verified remaining gap and preserves its marker and priority", async () => {
    const s = scene(assessment("partial"));

    s.issue.body =
      "Part of #20.\n\n**Depends on:** #21\n\n## Context\nThe rendering task\n\n<!-- lore-plan-task: spec-widget/T001 -->";
    await s.load();
    expect(await s.verify()).toEqual({ outcome: "partial" });
    expect({
      number: s.issue.number,
      labels: s.issue.labels,
      closed: s.project.issues.close.mock.calls,
    }).toEqual({ number: 42, labels: ["bug", "priority:medium"], closed: [] });
    expect(s.issue.body).toMatch(
      /Part of #20[\s\S]*Depends on[\s\S]*Already in place[\s\S]*colour prop is missing[\s\S]*lore-plan-task: spec-widget\/T001/,
    );
  });

  it("leaves missing work unchanged for reproduction", async () => {
    const s = scene(assessment("missing"));

    await s.load();
    expect(await s.verify()).toEqual({ outcome: "missing" });
    expect({ calls: s.calls, body: s.issue.body }).toEqual({
      calls: [],
      body: "Widgets must render correctly",
    });
  });

  it.each([
    "missing",
    "wrong-repo",
    "wrong-commit",
    "failed",
    "unexecuted",
    "unknown-id",
    "wrong-file",
    "wrong-line",
    "no-proof",
    "invented-test-text",
    "cross-test-range",
  ])("leaves bug 42 open when CI proof is %s", async (failure) => {
    const s = scene();
    const mutations: Record<string, () => void> = {
      missing: () => {
        s.deps.report = async () => null;
      },
      "wrong-repo": () => {
        s.report.repo = "other/repo";
      },
      "wrong-commit": () => {
        s.report.commit = "b".repeat(40);
      },
      failed: () => {
        s.report.outcomes[PROOF.test_id] = false;
      },
      unexecuted: () => {
        delete s.report.outcomes[PROOF.test_id];
      },
      "unknown-id": () => {
        s.report.tests[0].id = "different-case";
      },
      "wrong-file": () => {
        s.report.tests[0].file = "unrelated.test.ts";
      },
      "wrong-line": () => {
        s.report.tests[0].startLine = 2;
      },
      "no-proof": () => {
        const raw = assessment();

        raw.behavioral_proof = [];
        s.artifacts.implementation_assessment = JSON.stringify(raw);
      },
      "invented-test-text": () => {
        const raw = assessment();

        raw.behavioral_proof[0].evidence.text = "inventedAssertion";
        s.artifacts.implementation_assessment = JSON.stringify(raw);
      },
      "cross-test-range": () => {
        const raw = assessment();

        s.files[PROOF.evidence.path] +=
          '\nit("other case", () => {\nexpect(other()).toEqual("ignored");\n});\n';
        s.report.tests.push({
          ...s.report.tests[0],
          id: "other-test",
          startLine: 5,
        });
        s.report.outcomes["other-test"] = true;
        raw.behavioral_proof[0].evidence.end = 7;
        raw.behavioral_proof[0].evidence.text =
          'expect(other()).toEqual("ignored")';
        s.artifacts.implementation_assessment = JSON.stringify(raw);
      },
    };

    mutations[failure]();
    await s.load();
    expect(await s.verify()).toEqual({ outcome: "unproven" });
    expect({
      calls: s.calls,
      completion: s.artifacts.verified_completion,
    }).toEqual({ calls: [], completion: undefined });
  });

  it("does not cherry-pick one passing parameterized case while another case failed", async () => {
    const s = scene();

    s.report.tests.push({ ...s.report.tests[0], id: "widget-other-case" });
    s.report.outcomes["widget-other-case"] = false;
    await s.load();
    expect(await s.verify()).toEqual({ outcome: "unproven" });
  });

  it("rejects invented source evidence through three bounded corrections without issue writes", async () => {
    const raw = assessment();

    raw.statements[0].evidence[0].text = "inventedFunction";
    const s = scene(raw);

    await s.load();
    expect(await s.verify()).toMatchObject({ outcome: "changes_requested" });
    s.brief.iteration = 4;
    expect(await s.verify()).toMatchObject({ outcome: "failed" });
    expect(s.calls).toEqual([]);
  });

  it("leaves an edited issue or advanced main open instead of closing stale scope", async () => {
    const s = scene();

    await s.load();
    await s.verify();
    s.issue.body = "A newly reported failing edge case";
    expect(await s.finish()).toEqual({ outcome: "unproven" });
    expect(s.calls).toEqual([]);
  });

  it("leaves the issue open when main advances after its CI-backed assessment", async () => {
    const s = scene();

    await s.load();
    await s.verify();
    s.project.repo.headSha.mockResolvedValue("b".repeat(40));
    expect(await s.finish()).toEqual({ outcome: "unproven" });
  });

  it("rechecks the recorded outcome before closing when a CI rerun turns the test red", async () => {
    const s = scene();

    await s.load();
    await s.verify();
    s.report.outcomes[PROOF.test_id] = false;
    expect(await s.finish()).toEqual({ outcome: "unproven" });
    expect(s.calls).toEqual([]);
  });

  it("retries an interrupted close without duplicating its verified evidence comment", async () => {
    const s = scene();

    s.project.issues.close.mockRejectedValueOnce(
      new Error("GitHub unavailable"),
    );
    await s.load();
    await s.verify();
    expect([await s.finish(), await s.finish(), await s.finish()]).toEqual([
      { outcome: "failed", error: "GitHub unavailable" },
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect({ comments: s.comments.length, state: s.issue.state }).toEqual({
      comments: 1,
      state: "closed",
    });
  });

  it("keeps person-only operational work open even when a configuration test passes", async () => {
    const raw = assessment();

    Object.assign(raw.stories[0].tasks[0], {
      needs_person: "Apply Terraform to the live cluster",
    });
    const s = scene(raw);

    await s.load();
    expect(await s.verify()).toEqual({ outcome: "unproven" });
    expect({
      closed: s.project.issues.close.mock.calls,
      labels: s.issue.labels,
    }).toEqual({
      closed: [],
      labels: ["bug", "priority:medium", "lore:blocked"],
    });
  });
});

describe("the close-issue station", () => {
  it("posts the verdict comment before closing the issue", async () => {
    const s = scene();

    await s.load();
    await s.verify();
    await s.finish();

    expect(s.calls).toEqual(["comment", "close"]);
  });

  it("posts the verdict text on the correct issue and closes it", async () => {
    const s = scene();

    await s.load();
    await s.verify();
    await s.finish();

    expect(s.comments).toMatchObject([
      { body: expect.stringContaining("This issue is fully implemented.") },
    ]);
    expect(s.project.issues.close.mock.calls).toEqual([[42, "completed"]]);
  });

  it("leaves a legacy obsolete verdict open without verified behavioral proof", async () => {
    const s = scene();

    expect(await closeIssueHandle(s.deps)(s.brief, s.tools)).toEqual({
      outcome: "unproven",
    });
    expect(s.calls).toEqual([]);
  });
});
