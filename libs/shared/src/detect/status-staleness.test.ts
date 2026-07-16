import { describe, it, expect } from "vitest";
import {
  namedPaths,
  gatherEvidence,
  decideStale,
  formatStaleStatusReport,
  hasOpenStaleStatusIssue,
  statusStalenessJob,
  type StaleEvidence,
  type StaleFinding,
} from "./status-staleness.js";
import type { ChunkLineRange } from "./spec-coverage-validate.js";
import type { DriftTaskRow } from "../project/tasks/task-store-port.js";
import type { Project } from "../index.js";

const evidence = (over: Partial<StaleEvidence> = {}): StaleEvidence => ({
  resolvingTestLinks: 0,
  mergedTasks: 0,
  outstandingTasks: 0,
  namedPathsExisting: 0,
  namedPathsTotal: 0,
  ...over,
});

const specHeader = (status: string) => `# Feature Specification: Thing

| Field   | Value      |
|---------|------------|
| Status  | ${status}  |
`;

describe("namedPaths", () => {
  it("collects backticked repo-relative file paths", () => {
    const paths = namedPaths(
      "The core is `libs/shared/src/detect/x.ts` and the line is `libs/assembly-lines/src/y.yaml`.",
    );

    expect(paths).toEqual([
      "libs/shared/src/detect/x.ts",
      "libs/assembly-lines/src/y.yaml",
    ]);
  });

  it("ignores prose spans, bare symbols and spans without an extension", () => {
    expect(
      namedPaths("Set `Status` to `Implemented` via `rewriteSpecStatusRow`."),
    ).toEqual([]);
    expect(namedPaths("The `apps/floor` directory.")).toEqual([]);
    expect(namedPaths("Run `git log --oneline -3` first.")).toEqual([]);
  });

  it("dedupes repeats and strips a leading ./", () => {
    expect(namedPaths("`./src/a.ts` then `src/a.ts` again")).toEqual([
      "src/a.ts",
    ]);
  });
});

describe("gatherEvidence", () => {
  const testChunks: ChunkLineRange[] = [
    { file_path: "src/x.test.ts", start_line: 1, end_line: 50 },
  ];
  const knownPaths = new Set(["src/a.ts", "src/b.ts"]);

  it("counts test links that resolve to a real test chunk", () => {
    const content =
      "Does the thing. ([validated by `x.test.ts:42`](src/x.test.ts#L42))";

    expect(gatherEvidence(content, testChunks, knownPaths, [])).toMatchObject({
      resolvingTestLinks: 1,
    });
  });

  it("does not count a link whose line falls outside every test chunk", () => {
    const content = "Does the thing. ([validated by `x`](src/x.test.ts#L999))";

    expect(gatherEvidence(content, testChunks, knownPaths, [])).toMatchObject({
      resolvingTestLinks: 0,
    });
  });

  it("splits linked tasks into merged and still-in-flight", () => {
    const tasks: DriftTaskRow[] = [
      { status: "merged", created_at: "2026-01-01", issue_number: 1 },
      { status: "merged", created_at: "2026-01-02", issue_number: 2 },
      { status: "running", created_at: "2026-01-03", issue_number: 3 },
    ];

    expect(
      gatherEvidence("no links", testChunks, knownPaths, tasks),
    ).toMatchObject({
      mergedTasks: 2,
      outstandingTasks: 1,
    });
  });

  it("counts named paths present in the indexed code", () => {
    const content = "Touches `src/a.ts`, `src/b.ts` and `src/gone.ts`.";

    expect(gatherEvidence(content, testChunks, knownPaths, [])).toMatchObject({
      namedPathsExisting: 2,
      namedPathsTotal: 3,
    });
  });
});

describe("decideStale", () => {
  it("returns no reasons for a spec with no evidence", () => {
    expect(decideStale(evidence())).toEqual([]);
  });

  it("fires on a single resolving test link", () => {
    expect(decideStale(evidence({ resolvingTestLinks: 1 }))).toEqual([
      "1 inline test link resolves to real tests",
    ]);
  });

  it("fires when every linked task merged", () => {
    expect(decideStale(evidence({ mergedTasks: 3 }))).toEqual([
      "3 linked pipeline tasks merged, none outstanding",
    ]);
  });

  it("stays silent when a linked task is still outstanding", () => {
    expect(
      decideStale(evidence({ mergedTasks: 3, outstandingTasks: 1 })),
    ).toEqual([]);
  });

  it("fires when at least half of two-or-more named paths exist", () => {
    expect(
      decideStale(evidence({ namedPathsExisting: 1, namedPathsTotal: 2 })),
    ).toEqual(["1 of the 2 paths it names exist in the code"]);
  });

  it("stays silent for a single existing named path", () => {
    expect(
      decideStale(evidence({ namedPathsExisting: 1, namedPathsTotal: 1 })),
    ).toEqual([]);
  });

  it("stays silent when named paths are mostly missing", () => {
    expect(
      decideStale(evidence({ namedPathsExisting: 1, namedPathsTotal: 3 })),
    ).toEqual([]);
  });

  it("reports every signal that fires", () => {
    expect(
      decideStale(
        evidence({
          resolvingTestLinks: 2,
          mergedTasks: 1,
          namedPathsExisting: 2,
          namedPathsTotal: 2,
        }),
      ),
    ).toHaveLength(3);
  });
});

describe("formatStaleStatusReport", () => {
  const finding = (over: Partial<StaleFinding> = {}): StaleFinding => ({
    specPath: "specs/thing/spec.md",
    status: "draft",
    evidence: evidence({ resolvingTestLinks: 1 }),
    reasons: ["1 inline test link resolves to real tests"],
    ...over,
  });

  it("returns an empty string for no findings", () => {
    expect(formatStaleStatusReport([])).toBe("");
  });

  it("names the spec, its header status and every reason", () => {
    const body = formatStaleStatusReport([finding()]);

    expect(body).toContain("`specs/thing/spec.md`");
    expect(body).toContain("Header says **draft**");
    expect(body).toContain("- 1 inline test link resolves to real tests");
    expect(body).toContain("status-staleness");
  });

  it("truncates past 25 specs and says how many were dropped", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      finding({ specPath: `specs/s${i}/spec.md` }),
    );
    const body = formatStaleStatusReport(many);

    expect(body).toContain("`specs/s24/spec.md`");
    expect(body).not.toContain("`specs/s25/spec.md`");
    expect(body).toContain("_…and 5 more._");
  });
});

describe("hasOpenStaleStatusIssue", () => {
  it("true when an open issue carries the stale-spec-status label", () => {
    expect(
      hasOpenStaleStatusIssue([
        { labels: ["lore-managed", "stale-spec-status"] },
      ]),
    ).toBe(true);
  });

  it("false when no open issue carries the label", () => {
    expect(hasOpenStaleStatusIssue([{ labels: ["spec-link-rot"] }])).toBe(
      false,
    );
    expect(hasOpenStaleStatusIssue([])).toBe(false);
  });
});

// ── Orchestration: the spec's FR2 verification criteria ─────────────
// "seeding a repo with an implemented-but-Draft spec yields one detector
//  finding; a repo with honest headers yields zero."

interface FakeOpts {
  specs: Array<{ filePath: string; content: string }>;
  tasks?: DriftTaskRow[];
  openIssues?: { labels: string[] }[];
}

function fakeProject(opts: FakeOpts) {
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const project = {
    chunks: {
      specChunksWithIngest: async () =>
        opts.specs.map((s) => ({
          repo: "re-cinq/lore",
          filePath: s.filePath,
          content: s.content,
          ingestedAt: "2026-07-16",
        })),
      // Every `code` chunk: the job reads this one call for both the link
      // ranges and the set of paths the index knows.
      testChunkRanges: async () => [
        { filePath: "src/x.test.ts", startLine: 1, endLine: 50 },
        { filePath: "src/a.ts", startLine: 1, endLine: 20 },
        { filePath: "src/b.ts", startLine: 1, endLine: 20 },
      ],
    },
    tasks: {
      driftTasksForSpec: async () => opts.tasks ?? [],
    },
    issues: {
      list: async () => opts.openIssues ?? [],
      create: async (title: string, body: string, labels: string[]) => {
        created.push({ title, body, labels });

        return { url: "https://github.com/re-cinq/lore/issues/1", number: 1 };
      },
    },
  } as unknown as Project;

  return { project, created };
}

describe("statusStalenessJob", () => {
  const implementedButDraft = `${specHeader("Draft")}
Does the thing. ([validated by \`x.test.ts:42\`](src/x.test.ts#L42))
`;

  it("reports no specs for an empty repo", async () => {
    const { project, created } = fakeProject({ specs: [] });

    expect(
      await statusStalenessJob({ repoFilter: "re-cinq/lore", project }),
    ).toBe("No specs found");
    expect(created).toEqual([]);
  });

  it("yields one finding and files an issue naming the evidence for an implemented-but-Draft spec", async () => {
    const { project, created } = fakeProject({
      specs: [
        { filePath: "specs/thing/spec.md", content: implementedButDraft },
      ],
    });

    const summary = await statusStalenessJob({
      repoFilter: "re-cinq/lore",
      project,
    });

    expect(summary).toBe(
      "Checked 1 draft/in-progress specs in re-cinq/lore — 1 look implemented, 1 reports opened",
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: "Stale spec statuses",
      labels: ["stale-spec-status", "lore-managed"],
    });
    expect(created[0].body).toContain("`specs/thing/spec.md`");
    expect(created[0].body).toContain(
      "1 inline test link resolves to real tests",
    );
  });

  it("yields zero findings and files nothing for a repo with honest headers", async () => {
    const { project, created } = fakeProject({
      specs: [
        {
          filePath: "specs/shipped/spec.md",
          // Implemented, with all the evidence — an honest header, not a finding.
          content: `${specHeader("Implemented")}
Does the thing. ([validated by \`x.test.ts:42\`](src/x.test.ts#L42))
`,
        },
        {
          filePath: "specs/honest-draft/spec.md",
          // Genuinely a draft: no links, no tasks, names nothing that exists.
          content: `${specHeader("Draft")}
We might build the thing in \`src/future.ts\` one day.
`,
        },
      ],
    });

    const summary = await statusStalenessJob({
      repoFilter: "re-cinq/lore",
      project,
    });

    expect(summary).toBe(
      "Checked 1 draft/in-progress specs in re-cinq/lore — 0 look implemented, 0 reports opened",
    );
    expect(created).toEqual([]);
  });

  it("skips prose artifacts that carry no status header of their own", async () => {
    const { project, created } = fakeProject({
      specs: [
        { filePath: "specs/thing/plan.md", content: implementedButDraft },
      ],
    });

    const summary = await statusStalenessJob({
      repoFilter: "re-cinq/lore",
      project,
    });

    expect(summary).toBe(
      "Checked 0 draft/in-progress specs in re-cinq/lore — 0 look implemented, 0 reports opened",
    );
    expect(created).toEqual([]);
  });

  it("does not file a duplicate when an open stale-spec-status issue exists", async () => {
    const { project, created } = fakeProject({
      specs: [
        { filePath: "specs/thing/spec.md", content: implementedButDraft },
      ],
      openIssues: [{ labels: ["stale-spec-status"] }],
    });

    const summary = await statusStalenessJob({
      repoFilter: "re-cinq/lore",
      project,
    });

    expect(summary).toBe(
      "Checked 1 draft/in-progress specs in re-cinq/lore — 1 look implemented, 0 reports opened",
    );
    expect(created).toEqual([]);
  });

  it("treats every linked task merging as evidence on its own", async () => {
    const { project, created } = fakeProject({
      specs: [
        {
          filePath: "specs/thing/spec.md",
          content: `${specHeader("In Progress")}\nNo links here.\n`,
        },
      ],
      tasks: [{ status: "merged", created_at: "2026-01-01", issue_number: 1 }],
    });

    await statusStalenessJob({ repoFilter: "re-cinq/lore", project });

    expect(created).toHaveLength(1);
    expect(created[0].body).toContain("Header says **in-progress**");
    expect(created[0].body).toContain("merged, none outstanding");
  });
});

// Appended, not inserted: specs/spec-status-upkeep/spec.md links every test
// above by line number, and inserting silently redirects those links.
describe("gatherEvidence — settled vs in-flight task statuses", () => {
  const linked = (status: string): DriftTaskRow[] => [
    { status: "merged", created_at: "2026-01-01", issue_number: 1 },
    { status, created_at: "2026-01-02", issue_number: 2 },
  ];

  it.each(["completed", "failed", "cancelled", "retried"])(
    "a %s sibling is settled, so the merged-tasks signal still fires",
    (status) => {
      const found = gatherEvidence("no links", [], new Set(), linked(status));

      expect(found).toMatchObject({ mergedTasks: 1, outstandingTasks: 0 });
      expect(decideStale(found)).toEqual([
        "1 linked pipeline task merged, none outstanding",
      ]);
    },
  );

  it.each([
    "pending",
    "queued",
    "awaiting_approval",
    "running",
    "running-local",
    "review",
    "pr-created",
  ])("a %s sibling is in flight, so the signal stays silent", (status) => {
    const found = gatherEvidence("no links", [], new Set(), linked(status));

    expect(found).toMatchObject({ mergedTasks: 1, outstandingTasks: 1 });
    expect(decideStale(found)).toEqual([]);
  });
});

describe("statusStalenessJob — named-paths signal end to end", () => {
  it("scores paths against the same resolved-schema read the links use", async () => {
    const { project, created } = fakeProject({
      specs: [
        {
          filePath: "specs/thing/spec.md",
          content: `${specHeader("Draft")}\nTouches \`src/a.ts\` and \`src/b.ts\`.\n`,
        },
      ],
    });

    await statusStalenessJob({ repoFilter: "re-cinq/lore", project });

    expect(created).toHaveLength(1);
    expect(created[0].body).toContain("2 of the 2 paths it names exist");
  });
});
