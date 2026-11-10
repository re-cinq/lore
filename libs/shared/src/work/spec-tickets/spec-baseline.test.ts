import type { Item, RunView } from "@re-cinq/floor-client";
import { describe, expect, it, vi } from "vitest";
import { fileItem, valueItem } from "../../outbound/floor/floor-items.js";
import { specBaseline } from "./spec-baseline.js";

const SPEC_PATH = "specs/widget/spec.md";
const PLANNED = { repo: "Acme/Widget", specPath: SPEC_PATH, mergeSha: "c4" };
const PARENTS: Record<string, string> = { c4: "c3", c3: "c2", c2: "c1" };
const PARTIAL = {
  file: SPEC_PATH,
  line: 5,
  status: "partial",
  evidence: [{ path: "src/widget.ts", start: 1, end: 1, text: "render()" }],
};
const VERIFIED = JSON.stringify({
  spec_commit: "c2",
  stories: [],
  statements: [PARTIAL],
});

interface Earlier {
  id: string;
  commit?: string;
  outcome: string;
  specPath?: string;
}

function finished({ id, commit, outcome, specPath }: Earlier): RunView {
  return {
    id,
    lineId: "spec-tickets",
    lineHash: "line-hash",
    repo: "github.com/acme/widget",
    subjectKey: null,
    startItems: {
      spec_path: valueItem(specPath ?? SPEC_PATH),
      ...(commit ? { merge_sha: valueItem(commit) } : {}),
    },
    outcome,
    reason: null,
    createdAt: "2026-11-09T10:00:00.000Z",
    finishedAt: "2026-11-09T10:30:00.000Z",
  };
}

interface KeptRun {
  run: RunView;
  bag: Record<string, Item>;
}

type Named = Partial<Record<string, string>>;

interface Floor {
  pages?: RunView[][];
  blobs?: Named;
  bags?: Named;
  specs?: Named;
  parents?: Named;
}

function sources(floor: Floor) {
  const pages = floor.pages ?? [[]];
  const specs = floor.specs ?? { c3: "spec at c3", c2: "spec at c2" };
  const blobs = floor.blobs ?? { "blob-r2": VERIFIED };
  const bags = floor.bags ?? { r2: "blob-r2" };
  const list = vi.fn(async (_filter: unknown, page?: { cursor?: string }) => {
    const index = Number(page?.cursor ?? 0);

    return {
      items: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    };
  });
  const get = vi.fn(async (runId: string): Promise<KeptRun | null> => {
    const hash = bags[runId];
    const run = finished({ id: runId, commit: "c2", outcome: "success" });
    const bag: Record<string, Item> = hash
      ? { verified_decomposition: fileItem(hash) }
      : {};

    return { run, bag };
  });

  return {
    list,
    floor: {
      runs: { list, get },
      blobs: {
        get: async (hash: string) => {
          const stored = blobs[hash];

          return stored === undefined
            ? null
            : {
                bytes: new TextEncoder().encode(stored),
                contentType: "application/json",
              };
        },
      },
    },
    readSpec: async (_path: string, ref: string) => specs[ref] ?? null,
    firstParent: async (sha: string) => (floor.parents ?? PARENTS)[sha] ?? null,
  };
}

const SUCCEEDED = finished({ id: "r2", commit: "c2", outcome: "success" });
const FAILED = finished({ id: "r3", commit: "c3", outcome: "iteration_max" });

describe("specBaseline", () => {
  it("takes the spec at the merge of the newest successful run of it, with what that run found each statement to be", async () => {
    const older = finished({ id: "r1", commit: "c1", outcome: "success" });
    const baseline = await specBaseline(
      sources({ pages: [[FAILED, SUCCEEDED, older]] }),
      PLANNED,
    );

    expect(baseline).toEqual({
      commit: "c2",
      spec: "spec at c2",
      statements: [PARTIAL],
    });
  });

  it("passes over a newer successful run of another spec", async () => {
    const other = finished({
      id: "r3",
      commit: "c3",
      outcome: "success",
      specPath: "specs/gadget/spec.md",
    });
    const baseline = await specBaseline(
      sources({ pages: [[other, SUCCEEDED]] }),
      PLANNED,
    );

    expect(baseline).toMatchObject({ commit: "c2" });
  });

  it("passes over a successful run that names no merge", async () => {
    const unnamed = finished({ id: "r3", outcome: "success" });
    const baseline = await specBaseline(
      sources({ pages: [[unnamed, SUCCEEDED]] }),
      PLANNED,
    );

    expect(baseline).toMatchObject({ commit: "c2" });
  });

  it("asks the floor for the repository's finished runs of the line, two hundred a page", async () => {
    const given = sources({ pages: [[SUCCEEDED]] });

    await specBaseline(given, PLANNED);

    expect(given.list).toHaveBeenCalledExactlyOnceWith(
      { repo: "github.com/acme/widget", line: "spec-tickets", open: false },
      { limit: 200, cursor: undefined },
    );
  });

  it("follows the floor's cursor to a successful run on a later page", async () => {
    const given = sources({ pages: [[FAILED], [SUCCEEDED]] });

    expect(await specBaseline(given, PLANNED)).toMatchObject({ commit: "c2" });
    expect(given.list).toHaveBeenLastCalledWith(expect.anything(), {
      limit: 200,
      cursor: "1",
    });
  });

  it("compares with the spec before the first run that tried when none has succeeded", async () => {
    const cancelled = finished({
      id: "r2",
      commit: "c2",
      outcome: "cancelled",
    });
    const baseline = await specBaseline(
      sources({ pages: [[FAILED], [cancelled]], specs: { c1: "spec at c1" } }),
      PLANNED,
    );

    expect(baseline).toEqual({
      commit: "c1",
      spec: "spec at c1",
      statements: [],
    });
  });

  it("compares with the spec before this merge when no run of the spec has finished", async () => {
    const baseline = await specBaseline(sources({ pages: [[]] }), PLANNED);

    expect(baseline).toEqual({
      commit: "c3",
      spec: "spec at c3",
      statements: [],
    });
  });

  it("stops after five pages, then compares with the spec before the oldest run it reached", async () => {
    const given = sources({
      pages: [[FAILED], [], [], [], [], [SUCCEEDED]],
    });

    expect(await specBaseline(given, PLANNED)).toMatchObject({
      commit: "c2",
      statements: [],
    });
    expect(given.list).toHaveBeenCalledTimes(5);
  });

  it.each([
    {
      missing: "the successful run's spec can no longer be read",
      floor: { pages: [[SUCCEEDED]], specs: {} },
    },
    {
      missing: "the spec did not exist before the first run that tried",
      floor: { pages: [[FAILED]], specs: {} },
    },
    {
      missing: "the first merge to try has no parent",
      floor: { pages: [[FAILED]], parents: {} },
    },
  ])("compares with nothing when $missing", async ({ floor }) => {
    expect(await specBaseline(sources(floor), PLANNED)).toEqual({
      commit: null,
      spec: null,
      statements: [],
    });
  });

  it.each([
    { kept: "no verified decomposition", floor: { bags: {} } },
    { kept: "one the floor no longer holds", floor: { blobs: {} } },
    { kept: "one that is not JSON", floor: { blobs: { "blob-r2": "{" } } },
    {
      kept: "one that is not a decomposition",
      floor: { blobs: { "blob-r2": '{"statements":[]}' } },
    },
    {
      kept: "one that assessed no statement",
      floor: { blobs: { "blob-r2": '{"stories":[]}' } },
    },
  ])(
    "takes the spec with no verdicts from a successful run that kept $kept",
    async ({ floor }) => {
      const baseline = await specBaseline(
        sources({ pages: [[SUCCEEDED]], ...floor }),
        PLANNED,
      );

      expect(baseline).toEqual({
        commit: "c2",
        spec: "spec at c2",
        statements: [],
      });
    },
  );

  it("takes the spec with no verdicts when the floor no longer has the successful run", async () => {
    const given = sources({ pages: [[SUCCEEDED]] });

    given.floor.runs.get.mockResolvedValueOnce(null as never);

    expect(await specBaseline(given, PLANNED)).toMatchObject({
      commit: "c2",
      statements: [],
    });
  });
});
