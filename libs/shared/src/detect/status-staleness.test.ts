import { describe, it, expect } from "vitest";
import {
  namedPaths,
  specSlugFromPath,
  gatherEvidence,
  decideStale,
  formatStaleStatusReport,
  hasOpenStaleStatusIssue,
  statusStalenessJob,
  type StaleEvidence,
  type StaleFinding,
} from "./status-staleness.js";
import type { DriftTaskRow } from "../project/tasks/task-store-port.js";
import type { IssueFilter, Project } from "../index.js";

const evidence = (over: Partial<StaleEvidence> = {}): StaleEvidence => ({
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
  const knownPaths = new Set(["src/a.ts", "src/b.ts"]);

  // The ladder (require-status-matches-coverage) owns the links and reads a
  // half-linked spec as legitimately in progress. Counting them here reported
  // that spec as stale every week — including this feature's own spec, which
  // sits at 29/50 and is correctly In Progress.
  it("ignores inline test links entirely — the ladder owns them", () => {
    const content =
      "Does the thing. ([validated by `x.test.ts:42`](src/x.test.ts#L42))";

    expect(decideStale(gatherEvidence(content, knownPaths, []))).toEqual([]);
  });

  it("splits linked tasks into merged and still-in-flight", () => {
    const tasks: DriftTaskRow[] = [
      { status: "merged", created_at: "2026-01-01", issue_number: 1 },
      { status: "merged", created_at: "2026-01-02", issue_number: 2 },
      { status: "running", created_at: "2026-01-03", issue_number: 3 },
    ];

    expect(gatherEvidence("no links", knownPaths, tasks)).toMatchObject({
      mergedTasks: 2,
      outstandingTasks: 1,
    });
  });

  it("counts named paths present in the indexed code", () => {
    const content = "Touches `src/a.ts`, `src/b.ts` and `src/gone.ts`.";

    expect(gatherEvidence(content, knownPaths, [])).toMatchObject({
      namedPathsExisting: 2,
      namedPathsTotal: 3,
    });
  });
});

describe("decideStale", () => {
  it("returns no reasons for a spec with no evidence", () => {
    expect(decideStale(evidence())).toEqual([]);
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
          mergedTasks: 1,
          namedPathsExisting: 2,
          namedPathsTotal: 2,
        }),
      ),
    ).toHaveLength(2);
  });
});

describe("formatStaleStatusReport", () => {
  const finding = (over: Partial<StaleFinding> = {}): StaleFinding => ({
    specPath: "specs/thing/spec.md",
    status: "draft",
    evidence: evidence({ mergedTasks: 2 }),
    reasons: ["2 linked pipeline tasks merged, none outstanding"],
    ...over,
  });

  it("returns an empty string for no findings", () => {
    expect(formatStaleStatusReport([])).toBe("");
  });

  it("names the spec, its header status and every reason", () => {
    const body = formatStaleStatusReport([finding()]);

    expect(body).toContain("`specs/thing/spec.md`");
    expect(body).toContain("Header says **draft**");
    expect(body).toContain(
      "- 2 linked pipeline tasks merged, none outstanding",
    );
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
  /** Spec-task rows per feature slug — keyed exactly as the real store keys
   *  them (`context_bundle->>'spec_slug'`), so a job asking on the wrong key
   *  gets nothing back instead of a fake's blanket answer. */
  tasksBySlug?: Record<string, DriftTaskRow[]>;
  openIssues?: Array<{ labels: string[] }>;
}

function fakeProject(opts: FakeOpts) {
  const created: Array<{ title: string; body: string; labels: string[] }> = [];
  const listFilters: Array<IssueFilter | undefined> = [];
  const project = {
    chunks: {
      specChunksWithIngest: async () =>
        opts.specs.map((s) => ({
          repo: "re-cinq/lore",
          filePath: s.filePath,
          content: s.content,
          ingestedAt: "2026-07-16",
        })),
      // Every `code` chunk: the job reads this one call for the set of paths
      // the index knows about.
      testChunkRanges: async () => [
        { filePath: "src/x.test.ts", startLine: 1, endLine: 50 },
        { filePath: "src/a.ts", startLine: 1, endLine: 20 },
        { filePath: "src/b.ts", startLine: 1, endLine: 20 },
      ],
    },
    tasks: {
      specTasksForSlug: async (slug: string) => opts.tasksBySlug?.[slug] ?? [],
    },
    issues: {
      list: async (filter?: IssueFilter) => {
        listFilters.push(filter);

        const all = opts.openIssues ?? [];

        return filter?.labels?.length
          ? all.filter((i) => filter.labels?.some((l) => i.labels.includes(l)))
          : all;
      },
      create: async (title: string, body: string, labels: string[]) => {
        created.push({ title, body, labels });

        return { url: "https://github.com/re-cinq/lore/issues/1", number: 1 };
      },
    },
  } as unknown as Project;

  return { project, created, listFilters };
}

describe("statusStalenessJob", () => {
  // The case the ladder is blind to: shipped, but nobody wrote the links. Its
  // coverage says Draft and its header agrees, so require-status-matches-coverage
  // is satisfied — the code existing is the only thing that betrays it.
  const implementedButDraft = `${specHeader("Draft")}
Ships in \`src/a.ts\` and \`src/b.ts\`.
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
      "2 of the 2 paths it names exist in the code",
    );
  });

  // A half-linked spec sitting at In Progress is exactly what the ladder
  // prescribes — reporting it weekly was the false positive that this feature's
  // own spec (29/50 linked) would have tripped every Monday.
  it("files nothing for a partially-linked in-progress spec, which the ladder blesses", async () => {
    const { project, created } = fakeProject({
      specs: [
        {
          filePath: "specs/thing/spec.md",
          content: `${specHeader("In Progress")}
Does the thing. ([validated by \`x.test.ts:42\`](src/x.test.ts#L42))
Does another thing, unlinked.
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

  it("yields zero findings and files nothing for a repo with honest headers", async () => {
    const { project, created } = fakeProject({
      specs: [
        {
          filePath: "specs/shipped/spec.md",
          // Terminal bucket — never a candidate, whatever evidence it carries.
          content: `${specHeader("Implemented")}
Ships in \`src/a.ts\` and \`src/b.ts\`.
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
      tasksBySlug: {
        thing: [
          { status: "merged", created_at: "2026-01-01", issue_number: 1 },
        ],
      },
    });

    await statusStalenessJob({ repoFilter: "re-cinq/lore", project });

    expect(created).toHaveLength(1);
    expect(created[0].body).toContain("Header says **in-progress**");
    expect(created[0].body).toContain("merged, none outstanding");
  });

  // The signal was wired to `driftTasksForSpec(taskType, specPath)`, which keys
  // on `context_bundle->>'spec_path'` — a key no spec-task row has ever carried.
  // It silently returned zero rows for every spec, so this reason could never
  // fire in production while the fake happily answered in tests.
  it("asks for spec-tasks by the feature slug, not the spec path", async () => {
    const { project, created } = fakeProject({
      specs: [
        {
          filePath: "specs/thing/spec.md",
          content: `${specHeader("Draft")}\nNo links here.\n`,
        },
      ],
      tasksBySlug: {
        "specs/thing/spec.md": [
          { status: "merged", created_at: "2026-01-01", issue_number: 1 },
        ],
      },
    });

    await statusStalenessJob({ repoFilter: "re-cinq/lore", project });

    expect(created).toEqual([]);
  });

  it("passes the stale-spec-status label to the issue read rather than filtering in memory", async () => {
    const { project, listFilters } = fakeProject({
      specs: [
        { filePath: "specs/thing/spec.md", content: implementedButDraft },
      ],
      openIssues: [{ labels: ["unrelated"] }],
    });

    await statusStalenessJob({ repoFilter: "re-cinq/lore", project });

    expect(listFilters).toEqual([
      { state: "open", labels: ["stale-spec-status"] },
    ]);
  });
});

// Appended, not inserted: specs/spec-status-upkeep/spec.md links every test
// above by line number, and inserting silently redirects those links.
describe("specSlugFromPath", () => {
  it.each([
    ["specs/spec-status-upkeep/spec.md", "spec-status-upkeep"],
    ["specs/6-dark-factory/contracts/station-contract.md", "6-dark-factory"],
  ])("reads the feature slug out of %s", (path, slug) => {
    expect(specSlugFromPath(path)).toBe(slug);
  });

  it.each(["docs/spec.md", "spec.md", "specs/spec.md", ""])(
    "returns null for %s, which names no feature",
    (path) => {
      expect(specSlugFromPath(path)).toBeNull();
    },
  );
});

describe("gatherEvidence — settled vs in-flight task statuses", () => {
  const linked = (status: string): DriftTaskRow[] => [
    { status: "merged", created_at: "2026-01-01", issue_number: 1 },
    { status, created_at: "2026-01-02", issue_number: 2 },
  ];

  it.each(["completed", "failed", "cancelled", "retried"])(
    "a %s sibling is settled, so the merged-tasks signal still fires",
    (status) => {
      const found = gatherEvidence("no links", new Set(), linked(status));

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
    const found = gatherEvidence("no links", new Set(), linked(status));

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
