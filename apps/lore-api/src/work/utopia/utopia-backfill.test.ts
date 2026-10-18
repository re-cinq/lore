import { describe, it, expect } from "vitest";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import { backfillRepo, type BackfillFiles } from "./utopia-backfill.js";
import { docsToMirror } from "./ingested-docs.js";
import type { MirroredDoc } from "./utopia-mirror.js";

const TREE = [
  "specs/a/spec.md",
  ".specify/memory/constitution.md",
  "specs/a/notes.txt",
  "adrs/ADR-001-auth.md",
  "docs/managing-secrets.md",
  "README.md",
];

describe("docsToMirror", () => {
  it("selects specs/ and .specify/ markdown as spec and adrs/ markdown as adr without a manifest, skipping notes.txt, docs/ and README.md", () => {
    expect(docsToMirror(TREE, null)).toEqual([
      { path: "specs/a/spec.md", kind: "spec" },
      { path: ".specify/memory/constitution.md", kind: "spec" },
      { path: "adrs/ADR-001-auth.md", kind: "adr" },
    ]);
  });

  it("selects only docs/managing-secrets.md as spec when .lore/ingest.yml declares a specs glob under docs, keeping the built-in adrs/ prefix", () => {
    expect(docsToMirror(TREE, "specs:\n  - docs/**\n")).toEqual([
      { path: "docs/managing-secrets.md", kind: "spec" },
      { path: "adrs/ADR-001-auth.md", kind: "adr" },
    ]);
  });
});

const HEAD = "abc123";

const filesAt = (tree: string[]): BackfillFiles => ({
  defaultBranch: async () => "main",
  headSha: async (branch) => (branch === "main" ? HEAD : "other"),
  tree: async (ref) => (ref === HEAD ? tree : []),
  read: async (path, ref) =>
    path.endsWith(".md") ? `# ${path} at ${ref}` : null,
});

const NO_HISTORY = {
  repo: "re-cinq/lore",
  history: { branchHistory: async () => [] },
  cursor: { read: async () => "head", write: async () => {} },
  mirror: async () => LANDED,
};

const NO_ACTIVITY = {
  repo: "re-cinq/lore",
  tracker: { trackerActivity: async () => [] },
  cursor: { read: async () => "2026-10-16T00:00:00Z", write: async () => {} },
  mirror: async () => LANDED,
};

const NO_RELEASES = {
  repo: "re-cinq/lore",
  published: { tags: async () => [], releases: async () => [] },
  mirror: async () => ({ ...LANDED, items: 0, created: 0, updated: 0 }),
};

const NO_MEMORY = {
  base: "re-cinq/lore",
  rows: async () => [],
  cursor: { read: async () => "41", write: async () => {} },
  push: async () => ({ action: "created" as const }),
};

const NOTHING_ABOVE_41 = {
  from: "41",
  to: null,
  entries: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

const NOTHING_RELEASED = {
  tags: 0,
  releases: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

const NO_TRACKED = {
  from: "2026-10-16T00:00:00Z",
  to: null,
  entries: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

const NO_COMMITS = {
  branch: "main",
  from: "head",
  to: null,
  commits: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
};

const LANDED: MirrorOutcome = {
  items: 3,
  created: 2,
  updated: 1,
  unchanged: 0,
  failed: [],
};

describe("backfillRepo", () => {
  it("mirrors the two specs and the ADR of main's head abc123 at abc123, skips src/index.ts, and walks main's commits above the cursor and the issues and pull requests updated since its cursor and the tags and releases after them", async () => {
    const mirrored: MirroredDoc[] = [];
    const summary = await backfillRepo({
      memory: NO_MEMORY,
      files: filesAt([
        "specs/a/spec.md",
        "specs/b/spec.md",
        "adrs/ADR-001-auth.md",
        "src/index.ts",
      ]),
      mirror: async (doc) => {
        mirrored.push(doc);

        return LANDED;
      },
      history: NO_HISTORY,
      tracker: NO_ACTIVITY,
      releases: NO_RELEASES,
    });

    expect({ summary, mirrored }).toEqual({
      summary: {
        commit: HEAD,
        documents: 3,
        created: 6,
        updated: 3,
        unchanged: 0,
        failed: [],
        commits: NO_COMMITS,
        tracker: NO_TRACKED,
        releases: NOTHING_RELEASED,
        memory: { memories: NOTHING_ABOVE_41, episodes: NOTHING_ABOVE_41 },
      },
      mirrored: [
        {
          path: "specs/a/spec.md",
          kind: "spec",
          commit: HEAD,
          content: "# specs/a/spec.md at abc123",
        },
        {
          path: "specs/b/spec.md",
          kind: "spec",
          commit: HEAD,
          content: "# specs/b/spec.md at abc123",
        },
        {
          path: "adrs/ADR-001-auth.md",
          kind: "adr",
          commit: HEAD,
          content: "# adrs/ADR-001-auth.md at abc123",
        },
      ],
    });
  });

  it("names specs/b/spec.md, which Utopia refused, and adrs/ADR-001-auth.md, one of whose items failed, under failed while specs/a/spec.md lands", async () => {
    const outcomes: Record<string, () => MirrorOutcome> = {
      "specs/b/spec.md": () => {
        throw new Error("Utopia answered 422");
      },
      "adrs/ADR-001-auth.md": () => ({
        ...LANDED,
        created: 1,
        failed: ["stmt:adrs/ADR-001-auth.md#0001: Utopia answered 503"],
      }),
    };
    const summary = await backfillRepo({
      memory: NO_MEMORY,
      files: filesAt([
        "specs/a/spec.md",
        "specs/b/spec.md",
        "adrs/ADR-001-auth.md",
      ]),
      mirror: async ({ path }) => (outcomes[path] ?? (() => LANDED))(),
      history: NO_HISTORY,
      tracker: NO_ACTIVITY,
      releases: NO_RELEASES,
    });

    expect(summary).toEqual({
      commit: HEAD,
      documents: 3,
      created: 3,
      updated: 2,
      unchanged: 0,
      failed: [
        "specs/b/spec.md: Utopia answered 422",
        "adrs/ADR-001-auth.md: 1 of 3 items failed: stmt:adrs/ADR-001-auth.md#0001: Utopia answered 503",
      ],
      commits: NO_COMMITS,
      tracker: NO_TRACKED,
      releases: NOTHING_RELEASED,
      memory: { memories: NOTHING_ABOVE_41, episodes: NOTHING_ABOVE_41 },
    });
  });

  it("names the commit the walk stopped at under failed beside the documents, so the sweep and the script see it", async () => {
    const summary = await backfillRepo({
      memory: NO_MEMORY,
      files: filesAt(["specs/a/spec.md"]),
      mirror: async () => LANDED,
      history: {
        ...NO_HISTORY,
        history: {
          branchHistory: async () => [
            {
              sha: "c1",
              parents: [],
              subject: "One",
              body: "",
              author: "a",
              authoredAt: "t",
            },
          ],
        },
        mirror: async () => {
          throw new Error("Utopia answered 503");
        },
      },
      tracker: NO_ACTIVITY,
      releases: NO_RELEASES,
    });

    expect({
      failed: summary.failed,
      commits: summary.commits?.failed,
    }).toEqual({
      failed: ["c1: Utopia answered 503"],
      commits: ["c1: Utopia answered 503"],
    });
  });

  it("names the issue or pull request the tracker walk stopped at under failed beside the documents", async () => {
    const summary = await backfillRepo({
      memory: NO_MEMORY,
      files: filesAt(["specs/a/spec.md"]),
      mirror: async () => LANDED,
      history: NO_HISTORY,
      tracker: {
        ...NO_ACTIVITY,
        tracker: {
          trackerActivity: async () => [
            {
              kind: "pull",
              number: 6,
              title: "Six",
              body: "",
              author: "gedaiu",
              labels: [],
              openedAt: "t",
              closedAt: null,
              mergedAt: null,
              updatedAt: "u",
            },
          ],
        },
        mirror: async () => {
          throw new Error("Utopia answered 503");
        },
      },
      releases: NO_RELEASES,
    });

    expect({
      failed: summary.failed,
      tracker: summary.tracker?.failed,
    }).toEqual({
      failed: ["pull:6: Utopia answered 503"],
      tracker: ["pull:6: Utopia answered 503"],
    });
  });

  it("names the tag Utopia refused under failed beside the documents", async () => {
    const summary = await backfillRepo({
      memory: NO_MEMORY,
      files: filesAt(["specs/a/spec.md"]),
      mirror: async () => LANDED,
      history: NO_HISTORY,
      tracker: NO_ACTIVITY,
      releases: {
        ...NO_RELEASES,
        mirror: async () => ({
          ...LANDED,
          failed: ["tag:v1.1.0: Utopia answered 503"],
        }),
      },
    });

    expect({
      failed: summary.failed,
      releases: summary.releases?.failed,
    }).toEqual({
      failed: ["tag:v1.1.0: Utopia answered 503"],
      releases: ["tag:v1.1.0: Utopia answered 503"],
    });
  });

  it("walks the memories and episodes above their cursors and names episode:e7, which Utopia refused, under failed beside the documents", async () => {
    const summary = await backfillRepo({
      memory: {
        ...NO_MEMORY,
        rows: async (kind) =>
          kind === "episodes"
            ? [
                {
                  seq: "42",
                  document: {
                    external_id: "episode:e7",
                    filename: "episode-e7",
                    content: "x",
                  },
                },
              ]
            : [],
        push: async () => {
          throw new Error("Utopia answered 503");
        },
      },
      files: filesAt(["specs/a/spec.md"]),
      mirror: async () => LANDED,
      history: NO_HISTORY,
      tracker: NO_ACTIVITY,
      releases: NO_RELEASES,
    });

    expect({
      failed: summary.failed,
      episodes: summary.memory?.episodes.failed,
    }).toEqual({
      failed: ["episode:e7: Utopia answered 503"],
      episodes: ["episode:e7: Utopia answered 503"],
    });
  });
});
