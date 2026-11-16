import { describe, expect, it } from "vitest";
import { recordedPlanFloor } from "../../outbound/floor/recorded-plan-floor.js";
import {
  mergedSpecPaths,
  specNameOfRunKey,
  onlyLinksChanged,
  specFilingKey,
  specTicketsKey,
  startSpecTicketRuns,
  type SpecMerge,
  type SpecTicketsDeps,
} from "./floor-spec-tickets.js";

const MERGE: SpecMerge = {
  repo: "acme/widgets",
  prNumber: 7,
  merged: true,
  baseRef: "main",
  mergeCommitSha: "abc123",
  branch: "feature/widgets",
};

const IN_PROGRESS = "| Status | In Progress |\n\nA statement.";

function scene(
  specs: Record<string, string | null>,
  overrides: Partial<SpecTicketsDeps> = {},
) {
  const recorded = recordedPlanFloor();
  const deps: SpecTicketsDeps = {
    floor: recorded.floor,
    loopOn: async () => true,
    defaultBranch: () => Promise.resolve("main"),
    changedFiles: () =>
      Promise.resolve(
        Object.keys(specs).map((path) => ({ path, patch: null })),
      ),
    readSpec: (_repo, path) => Promise.resolve(specs[path] ?? null),
    openRuns: () => Promise.resolve([]),
    ...overrides,
  };
  const started = () =>
    recorded.requests.filter(({ path }) => path.endsWith("/start"));

  return { deps, started, recorded };
}

describe("mergedSpecPaths", () => {
  it("keeps only specs/<name>/spec.md and drops plan, tasks and nested files", () => {
    expect(
      mergedSpecPaths(
        [
          "specs/a/spec.md",
          "specs/a/plan.md",
          "specs/a/contracts/spec.md",
          "docs/spec.md",
          "specs/b/spec.md",
        ].map((path) => ({ path, patch: null })),
      ),
    ).toEqual(["specs/a/spec.md", "specs/b/spec.md"]);
  });
});

const RELINKED_PATCH = [
  "@@ -7,1 +7,1 @@",
  "-- **FR1**: It works. ([validated by works](a.test.ts#L10))",
  "+- **FR1**: It works. ([validated by works](a.test.ts#L12))",
].join("\n");

const REWORDED_PATCH = [
  "@@ -7,1 +7,1 @@",
  "-- **FR1**: It works. ([validated by works](a.test.ts#L10))",
  "+- **FR1**: It works always. ([validated by works](a.test.ts#L10))",
].join("\n");

const BARE_RELINKED_PATCH = [
  "@@ -7,1 +7,1 @@",
  "-- **SC-001**: A CI grep fails the job. (#33) ([validated by](../../.github/workflows/ci.yml#L559)).",
  "+- **SC-001**: A CI grep fails the job. (#33) ([validated by](../../.github/workflows/ci.yml#L594)).",
].join("\n");

describe("onlyLinksChanged", () => {
  it("is true when a patch only moves a validated-by link to another line", () => {
    expect(onlyLinksChanged(RELINKED_PATCH)).toBe(true);
  });

  it("is false when a patch rewords the statement beside its link", () => {
    expect(onlyLinksChanged(REWORDED_PATCH)).toBe(false);
  });

  it("is false for a patch GitHub left out, since nothing says the change is links only", () => {
    expect(onlyLinksChanged(null)).toBe(false);
  });

  it("is true when a patch only moves a bare validated-by link with no test name from ci.yml#L559 to ci.yml#L594", () => {
    expect(onlyLinksChanged(BARE_RELINKED_PATCH)).toBe(true);
  });
});

describe("specTicketsKey", () => {
  it("joins repository, spec path and merge commit", () => {
    expect(specTicketsKey("acme/widgets", "specs/a/spec.md", "abc123")).toBe(
      "acme/widgets:specs/a/spec.md@abc123",
    );
  });
});

describe("specFilingKey", () => {
  it("is the spec directory name behind a spec- prefix, with no slash for the marker to split on", () => {
    expect(specFilingKey("specs/7-feature-planning/spec.md")).toBe(
      "spec-7-feature-planning",
    );
  });
});

describe("specNameOfRunKey", () => {
  it("reads widgets out of key:acme/widgets:specs/widgets/spec.md@abc123, and null out of a plan run's key", () => {
    expect([
      specNameOfRunKey("key:acme/widgets:specs/widgets/spec.md@abc123"),
      specNameOfRunKey("plan_id:p1"),
      specNameOfRunKey(null),
    ]).toEqual(["widgets", null, null]);
  });
});

describe("startSpecTicketRuns", () => {
  it("starts nothing for acme/widgets while its spec tickets loop is switched off", async () => {
    const { deps, started } = scene(
      { "specs/a/spec.md": IN_PROGRESS },
      { loopOn: async () => false },
    );

    expect([await startSpecTicketRuns(MERGE, deps), started()]).toEqual([
      "spec tickets: started 0, skipped 0",
      [],
    ]);
  });

  it("starts one spec-tickets run per merged spec, keyed on repo, path and merge commit", async () => {
    const { deps, started } = scene({
      "specs/a/spec.md": IN_PROGRESS,
      "specs/b/spec.md": IN_PROGRESS,
    });

    const summary = await startSpecTicketRuns(MERGE, deps);

    expect(summary).toBe("spec tickets: started 2, skipped 0");
    expect(started().map((request) => request.body)).toEqual(
      ["a", "b"].map((name) => ({
        repo: "github.com/acme/widgets",
        startItems: {
          target: {
            kind: "git",
            ref: "github.com/acme/widgets@main",
            by: "lore",
          },
          spec_path: {
            kind: "value",
            ref: `specs/${name}/spec.md`,
            by: "lore",
          },
          merge_sha: { kind: "value", ref: "abc123", by: "lore" },
          key: {
            kind: "value",
            ref: `acme/widgets:specs/${name}/spec.md@abc123`,
            by: "lore",
          },
        },
      })),
    );
  });

  it.each([
    ["a close without a merge", { merged: false }],
    ["a merge into a branch that is not the default", { baseRef: "next" }],
  ])("starts nothing for %s", async (_name, change) => {
    const { deps, started } = scene({ "specs/a/spec.md": IN_PROGRESS });

    const summary = await startSpecTicketRuns({ ...MERGE, ...change }, deps);

    expect(summary).toBe("spec tickets: started 0, skipped 0");
    expect(started()).toEqual([]);
  });

  it("skips a rejected spec, a retired one, a shipped one and one the merge deleted", async () => {
    const { deps, started } = scene({
      "specs/rejected/spec.md": "| Status | Rejected |",
      "specs/retired/spec.md": "| Status | Retired |",
      "specs/shipped/spec.md": "| Status | Shipped |",
      "specs/deleted/spec.md": null,
    });

    const summary = await startSpecTicketRuns(MERGE, deps);

    expect(summary).toBe("spec tickets: started 0, skipped 4");
    expect(started()).toEqual([]);
  });

  it("skips a spec whose only change in the pull request is its test links", async () => {
    const { deps, started } = scene(
      { "specs/a/spec.md": IN_PROGRESS },
      {
        changedFiles: () =>
          Promise.resolve([{ path: "specs/a/spec.md", patch: RELINKED_PATCH }]),
      },
    );

    const summary = await startSpecTicketRuns(MERGE, deps);

    expect(summary).toBe("spec tickets: started 0, skipped 0");
    expect(started()).toEqual([]);
  });

  it("skips a spec whose run key is already open, so a redelivered merge starts no second run", async () => {
    const { deps, started } = scene(
      { "specs/a/spec.md": IN_PROGRESS },
      {
        openRuns: () =>
          Promise.resolve([
            { id: "run-1", key: "acme/widgets:specs/a/spec.md@abc123" },
          ]),
      },
    );

    const summary = await startSpecTicketRuns(MERGE, deps);

    expect(summary).toBe("spec tickets: started 0, skipped 1");
    expect(started()).toEqual([]);
  });

  it("cancels the open run of an earlier merge of specs/a/spec.md as superseded and starts one keyed on the new merge", async () => {
    const { deps, started, recorded } = scene(
      { "specs/a/spec.md": IN_PROGRESS },
      {
        openRuns: () =>
          Promise.resolve([
            { id: "run-old", key: "acme/widgets:specs/a/spec.md@000aaa" },
            { id: "run-b", key: "acme/widgets:specs/b/spec.md@000aaa" },
          ]),
      },
    );

    const summary = await startSpecTicketRuns(MERGE, deps);

    expect(summary).toBe("spec tickets: started 1, skipped 0");
    expect(
      recorded.requests
        .filter(({ path }) => path.endsWith("/cancel"))
        .map(({ path, body }) => ({ path, body })),
    ).toEqual([
      { path: "/assembly-runs/run-old/cancel", body: { reason: "superseded" } },
    ]);
    expect(started().map((request) => request.body)).toMatchObject([
      { startItems: { key: { ref: "acme/widgets:specs/a/spec.md@abc123" } } },
    ]);
  });
});

const TESTED = "[validated by works](a.test.ts#L1)";
const ALSO_TESTED = "[validated by holds](b.test.ts#L2)";
const PLANNED = "[from plan](https://lore.example/plans/p1#p_a)";

const LINKS_ONLY = [
  {
    change: "removes both links of a group",
    before: `It works. (#1) (${TESTED}, ${ALSO_TESTED})`,
    after: "It works. (#1)",
  },
  {
    change: "takes one link out of a group of two",
    before: `It works. (#1) (${TESTED}, ${ALSO_TESTED})`,
    after: `It works. (#1) (${TESTED})`,
  },
  {
    change: "adds a second link to a group of one",
    before: `It works. (#1) (${TESTED})`,
    after: `It works. (#1) (${TESTED}, ${ALSO_TESTED})`,
  },
  {
    change: "removes a group that sits before the sentence's period",
    before: `It works (#1) ([validated by](ci.yml#L5)).`,
    after: "It works (#1).",
  },
  {
    change: "takes one link of two out of a group before a period",
    before: `It works (#1) (${TESTED}, ${ALSO_TESTED}).`,
    after: `It works (#1) (${TESTED}).`,
  },
  {
    change:
      "takes a test link out of the group it shares with a from-plan link",
    before: `It works. (${PLANNED}, ${TESTED})`,
    after: `It works. (${PLANNED})`,
  },
  {
    change: "moves a test link labelled only by its title",
    before: "It works. ([stays up](a.test.ts#L1), [also](b.test.ts#L5))",
    after: "It works. ([stays up](a.test.ts#L8), [also](b.test.ts#L5))",
  },
  {
    change: "moves a test link labelled only by its file and line",
    before: "It works. ([a.test.ts:1](a.test.ts#L1))",
    after: "It works. ([a.test.ts:8](a.test.ts#L8))",
  },
  {
    change: "moves a test link with a stray bracket in its label",
    before: "It works. ([[stays up](a.test.ts#L1))",
    after: "It works. ([[stays up](a.test.ts#L8))",
  },
  {
    change: "moves an implemented-by link to source",
    before: "It works. ([implemented by](src/a.ts#L1))",
    after: "It works. ([implemented by](src/a.ts#L8))",
  },
  {
    change: "removes an implemented-by link to source",
    before: "It works. ([implemented by](src/a.ts#L1))",
    after: "It works.",
  },
  {
    change: "moves the line anchor of a link to source inside a sentence",
    before: "The [`run` handler](src/a.ts#L1) answers it.",
    after: "The [`run` handler](src/a.ts#L8) answers it.",
  },
];

const REAL_CHANGES = [
  {
    change: "rewords a statement while removing its links",
    before: `It works. (#1) (${TESTED}, ${ALSO_TESTED})`,
    after: "It works always. (#1)",
  },
  {
    change: "removes an issue tag beside a group",
    before: `It works. (#1) (${TESTED})`,
    after: `It works. (${TESTED})`,
  },
  {
    change: "removes a from-plan link",
    before: `It works. (${PLANNED}, ${TESTED})`,
    after: `It works. (${TESTED})`,
  },
  {
    change: "points a link to source at another file",
    before: "The [`run` handler](src/a.ts#L1) answers it.",
    after: "The [`run` handler](src/b.ts#L1) answers it.",
  },
  {
    change: "removes a link to source from a sentence",
    before: "The [`run` handler](src/a.ts#L1) answers it.",
    after: "The handler answers it.",
  },
];

describe("onlyLinksChanged on citation groups and other link shapes", () => {
  it.each(LINKS_ONLY)("is true when a patch $change", ({ before, after }) => {
    expect(onlyLinksChanged(patchOf(before, after))).toBe(true);
  });

  it.each(REAL_CHANGES)(
    "is false when a patch $change",
    ({ before, after }) => {
      expect(onlyLinksChanged(patchOf(before, after))).toBe(false);
    },
  );
});

function patchOf(before: string, after: string): string {
  return [
    "@@ -7,1 +7,1 @@",
    `-- **FR1**: ${before}`,
    `+- **FR1**: ${after}`,
  ].join("\n");
}

describe("startSpecTicketRuns on a spec merged from a plan's branch", () => {
  it("starts the run with source plan p1 for a spec merged from lore/feature-planning/p1", async () => {
    const { deps, started } = scene({ "specs/a/spec.md": IN_PROGRESS });

    await startSpecTicketRuns(
      { ...MERGE, branch: "lore/feature-planning/p1" },
      deps,
    );

    expect(started().map((request) => request.body)).toMatchObject([
      { startItems: { source_plan_id: { kind: "value", ref: "p1" } } },
    ]);
  });

  it("starts the run with no source plan for a spec merged from a person's branch", async () => {
    const { deps, started } = scene({ "specs/a/spec.md": IN_PROGRESS });

    await startSpecTicketRuns(MERGE, deps);

    const { startItems } = started()[0]?.body as { startItems: object };

    expect(Object.keys(startItems)).toEqual([
      "target",
      "spec_path",
      "merge_sha",
      "key",
    ]);
  });
});
