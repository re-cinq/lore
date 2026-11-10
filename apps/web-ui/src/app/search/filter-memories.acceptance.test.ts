// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { SearchResult, SearchViewProps } from "./SearchView";

const listAllRepos = vi.fn();
const searchMemory = vi.fn();
const getChunks = vi.fn();

vi.mock("@/lib/api/repos", () => ({
  listAllRepos,
  reposOrThrow: (result: { data: unknown }) => result.data,
}));
vi.mock("@/lib/api/memory", () => ({ searchMemory }));
vi.mock("@/lib/api/chunks", () => ({ getChunks }));

const { default: SearchPage } = await import("./page");

const HITS: SearchResult[] = [
  {
    key: "1",
    value: "a",
    agent_id: "agent",
    score: 0.9,
    source: "memory",
    repo: "re-cinq/lore",
  },
  {
    key: "2",
    value: "b",
    agent_id: "agent",
    score: 0.8,
    source: "fact",
    repo: "re-cinq/atlas",
  },
  {
    key: "3",
    value: "c",
    agent_id: "agent",
    score: 0.7,
    source: "memory",
    repo: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listAllRepos.mockResolvedValue({
    data: { repos: [{ full_name: "re-cinq/lore" }] },
  });
  searchMemory.mockResolvedValue({
    status: "ok",
    data: { results: HITS },
  });
  getChunks.mockResolvedValue({
    status: "ok",
    data: { chunks: [] },
  });
});

describe("filterCrossRepoMemories", () => {
  it("verifies a selected repo cannot show another repo's memory/fact hits", async () => {
    const filtered = (await SearchPage({
      searchParams: Promise.resolve({ q: "deploy", repo: "re-cinq/lore" }),
    })) as ReactElement<SearchViewProps>;
    const unfiltered = (await SearchPage({
      searchParams: Promise.resolve({ q: "deploy" }),
    })) as ReactElement<SearchViewProps>;

    expect(filtered.props.results.map((h) => h.key)).toEqual(["1", "3"]);
    expect(unfiltered.props.results.map((h) => h.key)).toEqual(["1", "2", "3"]);
  });
});
