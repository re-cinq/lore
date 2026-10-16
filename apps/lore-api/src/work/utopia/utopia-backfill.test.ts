import { describe, it, expect } from "vitest";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import {
  backfillRepo,
  docsToMirror,
  type BackfillFiles,
} from "./utopia-backfill.js";
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
  history: { branchHistory: async () => [], read: async () => null },
  cursor: { read: async () => "head", write: async () => {} },
  mirror: async () => LANDED,
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
  it("mirrors the two specs and the ADR of main's head abc123 at abc123, skips src/index.ts, and walks main's commits above the cursor after them", async () => {
    const mirrored: MirroredDoc[] = [];
    const summary = await backfillRepo({
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
      files: filesAt([
        "specs/a/spec.md",
        "specs/b/spec.md",
        "adrs/ADR-001-auth.md",
      ]),
      mirror: async ({ path }) => (outcomes[path] ?? (() => LANDED))(),
      history: NO_HISTORY,
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
    });
  });
});
