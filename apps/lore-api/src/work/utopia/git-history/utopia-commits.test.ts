import { describe, it, expect } from "vitest";
import type { CommitDetail } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { MirroredCommit } from "@re-cinq/lore-shared/utopia/commit-text.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import {
  MAX_COMMITS_PER_RUN,
  mirrorBranchCommits,
  type CommitHistoryDeps,
} from "./utopia-commits.js";

const detail = (sha: string): CommitDetail => ({
  sha,
  parents: [`${sha}-parent`],
  subject: `Change ${sha} (#1)`,
  body: "",
  author: "Szabo Bogdan",
  authoredAt: `${sha}-at`,
  files: [`apps/${sha}.ts`],
});

const LANDED: MirrorOutcome = {
  items: 1,
  created: 1,
  updated: 0,
  unchanged: 0,
  failed: [],
};

interface Walk {
  repo?: string;
  history: CommitDetail[];
  cursor?: string | null;
  outcomes?: Record<string, () => MirrorOutcome>;
}

function walk(setup: Walk) {
  const asked: Array<Record<string, unknown>> = [];
  const mirrored: MirroredCommit[] = [];
  const cursors: string[] = [];
  const deps: CommitHistoryDeps = {
    repo: setup.repo ?? "re-cinq/lore",
    history: {
      branchHistory: async (branch, opts) => {
        asked.push({ branch, ...opts });

        return setup.history;
      },
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
  it("walks the newest 200 commits of main above the stored cursor c0, mirrors c1 then c2 with their words, parents and changed files, advances the cursor after each, and answers from c0 to c2", async () => {
    const { deps, asked, mirrored, cursors } = walk({
      cursor: "c0",
      history: [detail("c1"), detail("c2")],
      outcomes: { c2: () => ({ ...LANDED, created: 0, updated: 1 }) },
    });

    expect({
      summary: await mirrorBranchCommits(deps, "main"),
      asked,
      mirrored,
      cursors,
      limit: MAX_COMMITS_PER_RUN,
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
          files: ["apps/c1.ts"],
        },
        {
          sha: "c2",
          parents: ["c2-parent"],
          subject: "Change c2 (#1)",
          body: "",
          author: "Szabo Bogdan",
          authoredAt: "c2-at",
          files: ["apps/c2.ts"],
        },
      ],
      cursors: ["c1", "c2"],
      limit: 200,
    });
  });

  it("stops at c2, whose push Utopia refused, leaving the cursor at c1 and c3 for the next walk, and names c2 under failed", async () => {
    const { deps, mirrored, cursors } = walk({
      history: [detail("c1"), detail("c2"), detail("c3")],
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
      history: [detail("c1")],
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

  it("answers nothing pushed when the branch holds no commit above the cursor c9", async () => {
    const { deps } = walk({ cursor: "c9", history: [] });

    expect(await mirrorBranchCommits(deps, "main")).toEqual({
      branch: "main",
      from: "c9",
      to: null,
      commits: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: [],
    });
  });

  it("runs a second walk of re-cinq/lore after the first, so it reads above the cursor the first moved, while a walk of re-cinq/otto runs beside them", async () => {
    const order: string[] = [];
    const slow = walk({ history: [detail("c1")] });
    const next = walk({ history: [] });
    const other = walk({ repo: "re-cinq/otto", history: [] });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    slow.deps.mirror = async () => {
      order.push("lore first mirroring");
      await held;

      return LANDED;
    };
    next.deps.cursor.read = async () => {
      order.push("lore second reading cursor");

      return "c1";
    };
    other.deps.cursor.read = async () => {
      order.push("otto reading cursor");

      return null;
    };
    const first = mirrorBranchCommits(slow.deps, "main");
    const second = mirrorBranchCommits(next.deps, "main");
    const otto = mirrorBranchCommits(other.deps, "main");

    await otto;
    order.push("otto done");
    release();
    await Promise.all([first, second]);

    expect({ steps: order.length, last: order.slice(-2) }).toEqual({
      steps: 4,
      last: ["otto done", "lore second reading cursor"],
    });
  });
});
