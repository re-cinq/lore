import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { specParts } from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import type { DecompTask } from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import {
  taskMarker,
  storyMarker,
} from "@re-cinq/lore-shared/feature-planning/plan-issues.js";
import type { CoverageDeps, RunVisit } from "../planning/coverage-deps.js";
import { verifyImplementationHandle } from "./verify-implementation/station.js";
import { specTicketsIssuesHandle } from "./file-issues/station.js";
import { issueCoverageHandle } from "./issue-coverage/station.js";

const PATH = "specs/widget/spec.md";
const SPEC =
  "# Widget\nA message list.\n## Requirements\n\n- The widget MUST render messages.\n- The widget MUST accept a colour prop.\n";
const PROOF = {
  path: "src/widget.ts",
  start: 1,
  end: 1,
  text: "ChatMessageList",
};

type RawTask = Omit<DecompTask, "spec_lines"> & { spec_lines: number[] };

function decomposition(status: "missing" | "partial" | "present" = "present") {
  const task: RawTask = {
    id: "T001",
    description: "Build the message list",
    depends_on: [],
    spec_lines: [5, 6],
    phase: 0,
    parallelizable: false,
  };

  return {
    spec_commit: "merge123",
    statements: [5, 6].map((line) => ({
      file: PATH,
      line,
      status,
      evidence: status === "missing" ? [] : [PROOF],
    })),
    stories: [
      {
        title: "Messages",
        tasks: [task],
      },
    ],
  };
}

type FiledIssue = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
};

function scene(
  raw: object = decomposition(),
  files: Record<string, string> = {
    [PATH]: SPEC,
    "src/widget.ts": "export function ChatMessageList() {}\n",
  },
) {
  const artifacts: Record<string, string> = {
    decomposition: JSON.stringify(raw),
  };
  const filed: FiledIssue[] = [];
  const comments: { id: number; number: number; body: string }[] = [];
  const closed: { number: number; reason: string }[] = [];
  const visits: RunVisit[] = [];
  const readSpec = vi.fn(
    async (_repo: string, path: string, _ref?: string) => files[path] ?? null,
  );
  const deps: CoverageDeps = {
    readSpec,
    listTree: async () => Object.keys(files),
    visitsOf: async () => visits,
    filedCoverage: async () => null,
  };
  const project = {
    repo: {
      read: async (path: string, ref?: string) =>
        readSpec("re-cinq/lore", path, ref),
    },
    issues: {
      list: async () => filed,
      listLabels: async () => [],
      listComments: async (number: number) =>
        comments.filter((comment) => comment.number === number),
      create: async (title: string, body: string, labels: string[]) => {
        const issue: FiledIssue = {
          number: 100 + filed.length,
          title,
          body,
          labels,
          state: "open",
        };

        filed.push(issue);

        return issue;
      },
      update: async (
        number: number,
        fields: { title?: string; body?: string },
      ) => {
        Object.assign(
          filed.find((issue) => issue.number === number)!,
          fields,
        );
      },
      comment: async (number: number, body: string) => {
        comments.push({ id: comments.length + 1, number, body });
      },
      updateComment: async () => {},
      addSubIssue: async () => {},
      close: vi.fn(async (number: number, reason: string) => {
        closed.push({ number, reason });
        filed.find((issue) => issue.number === number)!.state = "closed";
      }),
    },
  };
  const tools: Tools = {
    read: async (name) => Buffer.from(artifacts[name]),
    produce: async (name, bytes) => {
      artifacts[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const needs = {
    target: "https://github.com/re-cinq/lore@advanced-main",
    spec_path: PATH,
    merge_sha: "merge123",
    decomposition: "input",
  };
  const brief = { visitId: "verify-1", iteration: 1, needs };
  const verify = () => verifyImplementationHandle(deps)(brief, tools);
  const file = () =>
    specTicketsIssuesHandle({
      runOf: async () => "run-1",
      project: async () => project as never,
    })(
      { ...brief, needs: { ...needs, verified_decomposition: "verified" } },
      tools,
    );
  const coverage = () =>
    issueCoverageHandle(deps)(
      { ...brief, needs: { ...needs, verified_decomposition: "verified" } },
      tools,
    );

  return {
    artifacts,
    filed,
    comments,
    closed,
    visits,
    readSpec,
    project,
    verify,
    file,
    coverage,
    needs,
  };
}

describe("verified spec ticket flow", () => {
  it("files the full task when statement assessments are absent", async () => {
    const { statements: _statements, ...raw } = decomposition();
    const run = scene(raw);

    expect([await run.verify(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.filed.map(({ title }) => title)).toEqual([
      "User story: Messages",
      "T001: Build the message list",
    ]);
  });

  it("fails without issue writes when the merge spec cannot be read", async () => {
    const run = scene(decomposition(), {});

    expect({ report: await run.verify(), issues: run.filed }).toMatchObject({
      report: { outcome: "failed", error: expect.stringContaining("merge123") },
      issues: [],
    });
  });

  it("fails without issue writes when the repository API throws", async () => {
    const run = scene();

    run.readSpec.mockRejectedValueOnce(new Error("GitHub unavailable"));
    expect({ report: await run.verify(), issues: run.filed }).toEqual({
      report: { outcome: "failed", error: "GitHub unavailable" },
      issues: [],
    });
  });

  it("retries an interrupted close without duplicating its evidence comment", async () => {
    const run = scene();

    run.filed.push({
      number: 13,
      title: "T001: Build messages",
      body: taskMarker("spec-widget", "T001"),
      state: "open",
      labels: [],
    });
    run.project.issues.close.mockRejectedValueOnce(
      new Error("close interrupted"),
    );
    expect([await run.verify(), await run.file(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "failed", error: "close interrupted" },
      { outcome: "success" },
    ]);
    expect({
      closed: run.closed,
      comments: run.comments.length,
      issues: run.filed.length,
    }).toEqual({
      closed: [{ number: 13, reason: "completed" }],
      comments: 1,
      issues: 1,
    });
  });

  it("closes a removed T099 as not planned while implemented T001 completes", async () => {
    const run = scene();

    run.filed.push(
      ...["T001", "T099"].map((id, index): FiledIssue => ({
        number: 13 + index,
        title: id,
        body: taskMarker("spec-widget", id),
        state: "open",
        labels: [],
      })),
    );
    expect([await run.verify(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.closed).toEqual([
      { number: 13, reason: "completed" },
      { number: 14, reason: "not_planned" },
    ]);
  });

  it("files zero issues for present work and counts 2 of 2 statements at merge123", async () => {
    const run = scene();

    expect([
      await run.verify(),
      await run.file(),
      await run.coverage(),
    ]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect({
      issues: run.filed,
      coverage: run.artifacts.issue_coverage,
      pinned: run.readSpec.mock.calls.every((call) => call[2] === "merge123"),
    }).toEqual({
      issues: [],
      coverage: expect.stringContaining(
        "2 of 2 testable spec statements have a task or verified implementation evidence.",
      ),
      pinned: true,
    });
  });

  it("files the full message-list task when the repository has no implementation", async () => {
    const run = scene(decomposition("missing"), { [PATH]: SPEC });

    expect([await run.verify(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.filed.map(({ title }) => title)).toEqual([
      "User story: Messages",
      "T001: Build the message list",
    ]);
  });

  it("requests full-scope correction for fabricated evidence before any issue is filed", async () => {
    const raw = decomposition();

    raw.statements[0].evidence[0] = { ...PROOF, text: "Invented" };
    const run = scene(raw);

    expect({ report: await run.verify(), issues: run.filed }).toMatchObject({
      report: {
        outcome: "changes_requested",
        error: expect.stringContaining("restore the full task scope"),
      },
      issues: [],
    });
    run.artifacts.decomposition = JSON.stringify(decomposition("missing"));
    expect([await run.verify(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.filed).toHaveLength(2);
  });

  it("fails without writes after three rejected evidence handbacks", async () => {
    const raw = decomposition();

    raw.statements[0].evidence = [];
    const run = scene(raw);

    run.visits.push(
      ...Array.from({ length: 3 }, () => ({
        nodeId: "verify-implementation",
        report: { outcome: "changes_requested" },
      })),
    );
    expect(await run.verify()).toMatchObject({ outcome: "failed" });
    expect(run.filed).toEqual([]);
  });

  it("files only the missing colour prop with already-in-place permalinks", async () => {
    const raw = decomposition("partial");
    const task = {
      ...raw.stories[0].tasks[0],
      description: "Add colour prop",
      title: "Add colour prop",
      remaining: "Accept the colour prop",
      changes: "Add colour to the props",
      acceptance_criteria: ["colour reaches the widget"],
      test_plan: "Test colour forwarding",
      in_place: [5, 6].map((line) => ({ ...PROOF, file: PATH, line })),
    };

    raw.stories[0].tasks = [task];
    const run = scene(raw);

    expect([await run.verify(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.filed[1]).toMatchObject({
      title: "T001: Add colour prop",
      body: expect.stringContaining(
        "## Remaining work\n\nAccept the colour prop",
      ),
    });
    expect(run.filed[1].body).toMatch(
      /## Already in place[\s\S]*\/blob\/merge123\/src\/widget\.ts#L1-L1/,
    );
  });

  it("closes T001 and its existing story as completed exactly once with source evidence", async () => {
    const run = scene();

    run.filed.push(
      {
        number: 12,
        title: "Messages",
        body: storyMarker("spec-widget"),
        state: "open",
        labels: [],
      },
      {
        number: 13,
        title: "T001: Add colour prop",
        body: taskMarker("spec-widget", "T001"),
        state: "open",
        labels: [],
      },
    );
    expect([await run.verify(), await run.file(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.closed).toEqual([
      { number: 13, reason: "completed" },
      { number: 12, reason: "completed" },
    ]);
    expect(run.comments.filter((comment) => comment.number === 13)).toEqual([
      {
        id: 1,
        number: 13,
        body: expect.stringContaining("/blob/merge123/src/widget.ts#L1-L1"),
      },
    ]);
  });

  it("keeps mixed present and missing statements actionable and drops a satisfied dependency without an issue", async () => {
    const raw = decomposition();

    raw.statements[1] = {
      ...raw.statements[1],
      status: "missing",
      evidence: [],
    };
    raw.stories[0].tasks = [
      { ...raw.stories[0].tasks[0], spec_lines: [5] },
      {
        id: "T002",
        phase: 0,
        parallelizable: false,
        description: "Add colour",
        depends_on: ["T001"],
        spec_lines: [5, 6],
        remaining: "Add colour",
        changes: "Add colour",
        acceptance_criteria: ["Accept colour"],
        test_plan: "Test colour",
        in_place: [{ ...PROOF, file: PATH, line: 5 }],
      },
    ];
    const run = scene(raw);

    expect([await run.verify(), await run.file()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.filed.map(({ title }) => title)).toEqual([
      "User story: Messages",
      "T002: Add colour",
    ]);
    expect(run.filed[1].body).not.toContain("Depends on");
  });

  it("files no Bowman issues for verified existing ChatMessageList at 374d04b5 without validated-by links", async () => {
    const spec = readFileSync(
      new URL("./fixtures/bowman-374d04b5/spec.txt", import.meta.url),
      "utf8",
    ).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    const source = readFileSync(
      new URL(
        "./fixtures/bowman-374d04b5/ChatMessageList.txt",
        import.meta.url,
      ),
      "utf8",
    );
    const path = "specs/bowman-ui-message-list/spec.md";
    const proof = {
      path: "src/components/ChatMessageList.tsx",
      start: 1,
      end: source.trimEnd().split("\n").length,
      text: "ChatMessageList",
    };
    const statements = specParts(spec).map(({ line }) => ({
      file: path,
      line,
      status: "present",
      evidence: [proof],
    }));

    expect(statements.length).toBeGreaterThan(10);
    const run = scene(
      { spec_commit: "374d04b5", statements, stories: [] },
      { [path]: spec, [proof.path]: source },
    );

    run.needs.spec_path = path;
    run.needs.merge_sha = "374d04b5";
    expect([
      await run.verify(),
      await run.file(),
      await run.coverage(),
    ]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect(run.filed).toEqual([]);
  });
});
