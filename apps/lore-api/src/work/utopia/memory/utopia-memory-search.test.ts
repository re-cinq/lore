import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";
import type { UtopiaReads } from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import {
  searchUtopiaMemories,
  utopiaAssemblyOptions,
} from "./utopia-memory-search.js";

const ENV = { GITHUB_ORG: "re-cinq" };

interface StoredSource {
  id: string;
  key: string;
  kbId: string;
  cursor: null;
}

type Held = Record<
  string,
  Partial<Record<"memories" | "episodes", StoredSource>>
>;

const stored = (id: string, kbId: string): StoredSource => ({
  id,
  key: `key-${id}`,
  kbId,
  cursor: null,
});

const REPO_AND_ORG_HELD: Held = {
  "re-cinq/lore": {
    memories: stored("mem-repo", "kb-repo"),
    episodes: stored("epi-repo", "kb-repo"),
  },
  "re-cinq/memory": {
    memories: stored("mem-org", "kb-org"),
    episodes: stored("epi-org", "kb-org"),
  },
};

function poolHolding(held: Held) {
  const pool = makePool();

  pool.query.mockImplementation(
    async (_sql: string, [base, kind]: string[]) => {
      const source = held[base]?.[kind as "memories" | "episodes"];

      return { rows: source ? [source] : [] };
    },
  );

  return pool as unknown as Pool;
}

function hit(
  externalId: string,
  text: string,
  score: number,
  sourceId: string,
): SearchHit {
  return {
    chunkId: `c-${externalId}`,
    documentId: `d-${externalId}`,
    seq: 0,
    text,
    filename: externalId,
    sourceId,
    externalId,
    score,
    bm25Rank: null,
    vectorRank: 1,
  };
}

function readsAnswering(pages: Record<string, SearchHit[]>) {
  const searched: { kbId: string; q: string }[] = [];
  const reads: UtopiaReads = {
    async search(kbId, q) {
      searched.push({ kbId, q });

      return { hits: pages[kbId] ?? [], hasMore: false, vectorUsed: true };
    },
    async documentByExternalId() {
      return null;
    },
  };

  return { reads, searched };
}

const ask = (
  overrides: { repo?: string; limit?: number; repoFirst?: boolean } = {},
) => ({
  query: "gotchas",
  limit: 10,
  ...overrides,
});

describe("searchUtopiaMemories", () => {
  it("searches the repo base kb-repo and the org base kb-org for re-cinq/lore and answers both bases' hits best first", async () => {
    const { reads, searched } = readsAnswering({
      "kb-repo": [hit("memory:a/repo-note", "repo-note\n\nv", 0.4, "mem-repo")],
      "kb-org": [hit("memory:a/org-note", "org-note\n\nv", 0.9, "mem-org")],
    });
    const answer = await searchUtopiaMemories(
      poolHolding(REPO_AND_ORG_HELD),
      reads,
      ask({ repo: "re-cinq/lore" }),
      ENV,
    );

    expect({
      searched,
      ranked: answer?.map(({ key, score }) => ({ key, score })),
    }).toEqual({
      searched: [
        { kbId: "kb-repo", q: "gotchas" },
        { kbId: "kb-org", q: "gotchas" },
      ],
      ranked: [
        { key: "org-note", score: 1 },
        { key: "repo-note", score: 0.4 / 0.9 },
      ],
    });
  });

  it("searches only the org base when the search names no repo", async () => {
    const { reads, searched } = readsAnswering({});

    await searchUtopiaMemories(
      poolHolding(REPO_AND_ORG_HELD),
      reads,
      ask(),
      ENV,
    );

    expect(searched).toEqual([{ kbId: "kb-org", q: "gotchas" }]);
  });

  it("skips a base with no stored source and answers null when none has one", async () => {
    const { reads, searched } = readsAnswering({});
    const answer = await searchUtopiaMemories(
      poolHolding({}),
      reads,
      ask({ repo: "re-cinq/lore" }),
      ENV,
    );

    expect({ answer, searched }).toEqual({ answer: null, searched: [] });
  });

  it("keeps only hits of the base's own source ids", async () => {
    const { reads } = readsAnswering({
      "kb-org": [
        hit("memory:a/foreign", "foreign\n\nv", 0.9, "someone-elses-source"),
        hit("memory:a/own", "own\n\nv", 0.5, "mem-org"),
      ],
    });
    const answer = await searchUtopiaMemories(
      poolHolding(REPO_AND_ORG_HELD),
      reads,
      ask(),
      ENV,
    );

    expect(answer?.map(({ key }) => key)).toEqual(["own"]);
  });

  it("cuts the merged answer to the limit", async () => {
    const { reads } = readsAnswering({
      "kb-repo": [hit("memory:a/one", "one\n\nv", 0.9, "mem-repo")],
      "kb-org": [hit("memory:a/two", "two\n\nv", 0.8, "mem-org")],
    });
    const answer = await searchUtopiaMemories(
      poolHolding(REPO_AND_ORG_HELD),
      reads,
      ask({ repo: "re-cinq/lore", limit: 1 }),
      ENV,
    );

    expect(answer?.map(({ key }) => key)).toEqual(["one"]);
  });

  it("answers the repo base's hit before the org base's higher scored one when repoFirst, the scores still scaled to the best", async () => {
    const { reads } = readsAnswering({
      "kb-repo": [hit("memory:a/repo-note", "repo-note\n\nv", 0.4, "mem-repo")],
      "kb-org": [hit("memory:a/org-note", "org-note\n\nv", 0.9, "mem-org")],
    });
    const answer = await searchUtopiaMemories(
      poolHolding(REPO_AND_ORG_HELD),
      reads,
      ask({ repo: "re-cinq/lore", repoFirst: true }),
      ENV,
    );

    expect(answer?.map(({ key, score }) => ({ key, score }))).toEqual([
      { key: "repo-note", score: 0.4 / 0.9 },
      { key: "org-note", score: 1 },
    ]);
  });

  it("searches the repo base once when the org names no GITHUB_ORG", async () => {
    const { reads, searched } = readsAnswering({});

    await searchUtopiaMemories(
      poolHolding(REPO_AND_ORG_HELD),
      reads,
      ask({ repo: "re-cinq/lore" }),
      {},
    );

    expect(searched).toEqual([{ kbId: "kb-repo", q: "gotchas" }]);
  });
});

describe("utopiaAssemblyOptions", () => {
  const mirror = { kbId: "kb-repo", docsSourceId: "docs-1" };
  const optionsWith = (rows: unknown[]) => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows });

    return utopiaAssemblyOptions(
      pool as unknown as Pool,
      "re-cinq/lore",
      mirror,
      ENV,
    );
  };

  it("adds the test-coverage source cov-1 the repo's kind-source row holds to its mirror", async () => {
    expect((await optionsWith([{ id: "cov-1" }])).utopiaMirror).toEqual({
      ...mirror,
      coverageSourceId: "cov-1",
    });
  });

  it("leaves the mirror as it is when the repo has no test-coverage source", async () => {
    expect((await optionsWith([])).utopiaMirror).toEqual(mirror);
  });
});
