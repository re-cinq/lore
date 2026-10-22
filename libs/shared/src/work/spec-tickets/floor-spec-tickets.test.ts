import { describe, expect, it } from "vitest";
import { recordedPlanFloor } from "../../outbound/floor/recorded-plan-floor.js";
import {
  mergedSpecPaths,
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
};

const IN_PROGRESS = "| Status | In Progress |\n\nA statement.";

function scene(
  specs: Record<string, string | null>,
  overrides: Partial<SpecTicketsDeps> = {},
) {
  const recorded = recordedPlanFloor();
  const deps: SpecTicketsDeps = {
    floor: recorded.floor,
    defaultBranch: () => Promise.resolve("main"),
    changedFiles: () =>
      Promise.resolve(
        Object.keys(specs).map((path) => ({ path, patch: null })),
      ),
    readSpec: (_repo, path) => Promise.resolve(specs[path] ?? null),
    openRunKeys: () => Promise.resolve([]),
    ...overrides,
  };
  const started = () =>
    recorded.requests.filter(({ path }) => path.endsWith("/start"));

  return { deps, started };
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

describe("startSpecTicketRuns", () => {
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
        openRunKeys: () =>
          Promise.resolve(["acme/widgets:specs/a/spec.md@abc123"]),
      },
    );

    const summary = await startSpecTicketRuns(MERGE, deps);

    expect(summary).toBe("spec tickets: started 0, skipped 1");
    expect(started()).toEqual([]);
  });
});
