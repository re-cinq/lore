import { describe, it, expect } from "vitest";
import type { CommitDetail } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { MirroredCommit } from "@re-cinq/lore-shared/utopia/commit-statements.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import {
  MAX_COMMITS_PER_RUN,
  mirrorBranchCommits,
  type CommitHistoryDeps,
} from "./utopia-commits.js";

const detail = (sha: string, files: string[]): CommitDetail => ({
  sha,
  parents: [`${sha}-parent`],
  subject: `Change ${sha} (#1)`,
  body: "",
  author: "Szabo Bogdan",
  authoredAt: `${sha}-at`,
  files: files.map((path) => ({ path, status: "modified" })),
});

const LANDED: MirrorOutcome = {
  items: 1,
  created: 1,
  updated: 0,
  unchanged: 0,
  failed: [],
};

interface Walk {
  history: CommitDetail[];
  manifest?: string | null;
  cursor?: string | null;
  outcomes?: Record<string, () => MirrorOutcome>;
}

function walk(setup: Walk) {
  const asked: Array<Record<string, unknown>> = [];
  const mirrored: MirroredCommit[] = [];
  const cursors: string[] = [];
  const deps: CommitHistoryDeps = {
    history: {
      branchHistory: async (branch, opts) => {
        asked.push({ branch, ...opts });

        return setup.history;
      },
      read: async (path) =>
        path === ".lore/ingest.yml" ? (setup.manifest ?? null) : null,
    },
    cursor: {
      read: async () => setup.cursor ?? null,
      write: async (sha) => {
        cursors.push(sha);
      },
    },
    mirror: async (commit) => {
      mirrored.push(commit);

      return (setup.outcomes?.[commit.sha] ?? (() => LANDED))();
    },
  };

  return { deps, asked, mirrored, cursors };
}

describe("mirrorBranchCommits", () => {
  it("walks main above the stored cursor c0 with the run's limit, mirrors c1 then c2 with their paths classed as spec, adr or code, advances the cursor after each, and answers from c0 to c2", async () => {
    const { deps, asked, mirrored, cursors } = walk({
      cursor: "c0",
      history: [
        detail("c1", ["specs/a/spec.md", "src/a.ts"]),
        detail("c2", ["adrs/ADR-001-auth.md", "docs/x.md"]),
      ],
      outcomes: { c2: () => ({ ...LANDED, created: 0, updated: 1 }) },
    });

    expect({
      summary: await mirrorBranchCommits(deps, "main"),
      asked,
      mirrored,
      cursors,
    }).toEqual({
      summary: {
        branch: "main",
        from: "c0",
        to: "c2",
        commits: 2,
        created: 1,
        updated: 1,
        unchanged: 0,
        failed: [],
      },
      asked: [{ branch: "main", until: "c0", limit: MAX_COMMITS_PER_RUN }],
      mirrored: [
        {
          sha: "c1",
          parents: ["c1-parent"],
          subject: "Change c1 (#1)",
          body: "",
          author: "Szabo Bogdan",
          authoredAt: "c1-at",
          files: [
            { path: "specs/a/spec.md", kind: "spec" },
            { path: "src/a.ts", kind: "code" },
          ],
        },
        {
          sha: "c2",
          parents: ["c2-parent"],
          subject: "Change c2 (#1)",
          body: "",
          author: "Szabo Bogdan",
          authoredAt: "c2-at",
          files: [
            { path: "adrs/ADR-001-auth.md", kind: "adr" },
            { path: "docs/x.md", kind: "code" },
          ],
        },
      ],
      cursors: ["c1", "c2"],
    });
  });

  it("classes docs/x.md as spec when .lore/ingest.yml declares a specs glob under docs", async () => {
    const { deps, mirrored } = walk({
      manifest: "specs:\n  - docs/**\n",
      history: [detail("c1", ["docs/x.md"])],
    });

    await mirrorBranchCommits(deps, "main");

    expect(mirrored[0]?.files).toEqual([{ path: "docs/x.md", kind: "spec" }]);
  });

  it("stops at c2, whose push Utopia refused, leaving the cursor at c1 and c3 for the next walk, and names c2 under failed", async () => {
    const { deps, mirrored, cursors } = walk({
      history: [detail("c1", []), detail("c2", []), detail("c3", [])],
      outcomes: {
        c2: () => {
          throw new Error("Utopia answered 503");
        },
      },
    });

    expect({
      summary: await mirrorBranchCommits(deps, "main"),
      mirrored: mirrored.map((commit) => commit.sha),
      cursors,
    }).toEqual({
      summary: {
        branch: "main",
        from: null,
        to: "c1",
        commits: 1,
        created: 1,
        updated: 0,
        unchanged: 0,
        failed: ["c2: Utopia answered 503"],
      },
      mirrored: ["c1", "c2"],
      cursors: ["c1"],
    });
  });

  it("names c1 under failed when one of its items failed, and moves no cursor", async () => {
    const { deps, cursors } = walk({
      history: [detail("c1", [])],
      outcomes: {
        c1: () => ({ ...LANDED, failed: ["commit:c1: Utopia answered 422"] }),
      },
    });

    expect({
      summary: await mirrorBranchCommits(deps, "main"),
      cursors,
    }).toEqual({
      summary: {
        branch: "main",
        from: null,
        to: null,
        commits: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: ["c1: 1 of 1 items failed: commit:c1: Utopia answered 422"],
      },
      cursors: [],
    });
  });

  it("reads no manifest and answers nothing pushed when the branch holds no commit above the cursor", async () => {
    const reads: string[] = [];
    const { deps } = walk({ cursor: "c9", history: [] });

    deps.history.read = async (path) => {
      reads.push(path);

      return null;
    };

    expect({
      summary: await mirrorBranchCommits(deps, "main"),
      reads,
    }).toEqual({
      summary: {
        branch: "main",
        from: "c9",
        to: null,
        commits: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        failed: [],
      },
      reads: [],
    });
  });
});
