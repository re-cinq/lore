import { describe, it, expect } from "vitest";
import {
  dispatchSpecTrace,
  enforceProjectionComplete,
} from "./spec-trace-dispatch.js";
import type { DgraphClientPort } from "@re-cinq/lore-shared";

/**
 * dispatchSpecTrace routes a posted spec-trace trigger by kind: repo-read kinds
 * (specs/adrs) read the repo and project markdown; payload kinds
 * (test-report/coverage) go to the shared ingestSpecTrace. Exercised with a fake
 * project (empty tree → no graph writes) and a stub dgraph — no live Dgraph.
 */
const stubDgraph = {} as DgraphClientPort;

function fakeProjectFor() {
  const reposAskedFor: string[] = [];
  const projectFor = async (repo: string) => {
    reposAskedFor.push(repo);

    return { repo: { tree: async () => [] as string[], read: async () => "" } };
  };

  return { projectFor, reposAskedFor };
}

describe("dispatchSpecTrace", () => {
  it("projects from the repo and returns a graph-ingest audit/log for the specs kind", async () => {
    const f = fakeProjectFor();

    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123" },
      {
        dgraph: stubDgraph,
        projectFor: f.projectFor,
      },
    );

    expect(f.reposAskedFor).toEqual(["re-cinq/lore"]);
    expect(result.audit).toMatchObject({
      event_type: "spec_trace_ingest",
      repo: "re-cinq/lore",
    });
    expect((result.audit.payload as { kind: string }).kind).toBe("specs");
    expect(result.logLine).toContain("[floor] spec-trace specs re-cinq/lore");
    expect(result.failedFiles).toEqual([]);
  });

  it("surfaces failedFiles ['specs/a/spec.md'] when the one spec in the tree fails to project", async () => {
    const projectFor = async (_repo: string) => ({
      repo: {
        tree: async () => ["specs/a/spec.md"],
        read: async () => "# Spec A\n\nA statement.\n",
      },
    });
    // The stub port has no newTxn, so every dgraph write throws → the per-file
    // catch records the file and the summary carries it.
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123" },
      { dgraph: stubDgraph, projectFor },
    );

    expect(result.failedFiles).toEqual(["specs/a/spec.md"]);
    expect(result.logLine).toContain("failed=1");
    expect(result.audit).toMatchObject({ event_type: "spec_trace_ingest" });
  });

  it("enforceProjectionComplete throws naming the 2 failed files for a partial specs failure", () => {
    expect(() =>
      enforceProjectionComplete("re-cinq/lore", "specs", [
        "specs/a/spec.md",
        "specs/b/spec.md",
      ]),
    ).toThrow(
      /2 file\(s\) failed to project.*specs\/a\/spec\.md, specs\/b\/spec\.md/,
    );
  });

  it("enforceProjectionComplete returns silently for an empty failedFiles list", () => {
    expect(() =>
      enforceProjectionComplete("re-cinq/lore", "adrs", []),
    ).not.toThrow();
  });

  it("routes a docs kind to the ingest line instead of projecting inline", async () => {
    const started: Array<Record<string, unknown>> = [];
    const projectFor = async (_repo: string) => ({
      repo: {
        tree: async (): Promise<string[]> => {
          throw new Error("line routing must not read the repo");
        },
        read: async () => "",
      },
    });
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123" },
      {
        dgraph: stubDgraph,
        projectFor,
        startLine: async (input) => {
          started.push(input as unknown as Record<string, unknown>);

          return "a1b2c3d4-0000-0000-0000-000000000000";
        },
      },
    );

    expect(started).toEqual([
      {
        definitionName: "ingest",
        repo: "re-cinq/lore",
        branch: "abc123",
        args: { kind: "specs" },
      },
    ]);
    expect(result.failedFiles).toEqual([]);
    expect(result.logLine).toContain("ingest line a1b2c3d4");
  });

  it("threads glob and force into the line args as strings", async () => {
    const started: Array<Record<string, unknown>> = [];
    const projectFor = async (_repo: string) => ({
      repo: { tree: async () => [] as string[], read: async () => "" },
    });

    await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true, glob: "specs/auth/" },
      {
        dgraph: stubDgraph,
        projectFor,
        startLine: async (input) => {
          started.push(input as unknown as Record<string, unknown>);

          return "lineid";
        },
      },
    );

    expect(started[0]).toMatchObject({
      args: { kind: "specs", glob: "specs/auth/", force: "true" },
    });
  });

  it("chunks a force run without a glob into one child event per top-level dir instead of projecting inline", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const projectFor = async (_repo: string) => ({
      repo: {
        tree: async () => [
          "specs/auth/spec.md",
          "specs/billing/spec.md",
          ".specify/overview.md",
        ],
        read: async () => {
          throw new Error("chunking must not read file contents");
        },
      },
    });
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true },
      {
        dgraph: stubDgraph,
        projectFor,
        insertEvent: async (input) => {
          inserted.push(input as unknown as Record<string, unknown>);
        },
      },
    );

    expect(inserted).toHaveLength(3);
    expect(inserted[0]).toMatchObject({
      eventName: "internal.ingest.spec_trace",
      source: "internal",
      dedupeKey: "spec-trace-force:specs:abc123:.specify/",
      params: {
        kind: "specs",
        repo: "re-cinq/lore",
        payload: { commit: "abc123", force: true, glob: ".specify/" },
      },
    });
    expect(
      inserted.map(
        (i) => (i.params as { payload: { glob: string } }).payload.glob,
      ),
    ).toEqual([".specify/", "specs/auth/", "specs/billing/"]);
    expect(result.failedFiles).toEqual([]);
    expect(result.logLine).toContain("chunked into 3");
  });

  it("projects a force run WITH a glob inline — chunks never re-chunk", async () => {
    const inserted: unknown[] = [];
    const projectFor = async (_repo: string) => ({
      repo: {
        tree: async () => [] as string[],
        read: async () => "",
      },
    });
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true, glob: "specs/auth/" },
      {
        dgraph: stubDgraph,
        projectFor,
        insertEvent: async (input) => {
          inserted.push(input);
        },
      },
    );

    expect(inserted).toEqual([]);
    expect(result.logLine).toContain("[floor] spec-trace specs re-cinq/lore");
  });

  it("routes a payload kind to the ingest line by event reference", async () => {
    const started: Array<Record<string, unknown>> = [];
    const projectFor = async (_repo: string) => ({
      repo: { tree: async () => [] as string[], read: async () => "" },
    });
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "test-report",
      { commit: "abc123", tests: [] },
      {
        dgraph: stubDgraph,
        projectFor,
        eventId: "4711",
        startLine: async (input) => {
          started.push(input as unknown as Record<string, unknown>);

          return "lineid00-0000";
        },
      },
    );

    expect(started).toEqual([
      {
        definitionName: "ingest",
        repo: "re-cinq/lore",
        branch: "abc123",
        args: { kind: "test-report", payload_event_id: "4711" },
      },
    ]);
    expect(result.failedFiles).toEqual([]);
    expect(result.logLine).toContain("ingest line lineid00");
  });

  it("routes an unrecognized kind to ingestSpecTrace, which rejects without reading the repo", async () => {
    const f = fakeProjectFor();

    await expect(
      dispatchSpecTrace(
        "re-cinq/lore",
        "bogus",
        {},
        { dgraph: stubDgraph, projectFor: f.projectFor },
      ),
    ).rejects.toThrow(new Error('ingestSpecTrace: unrecognized kind "bogus"'));
    expect(f.reposAskedFor).toEqual([]);
  });
});
