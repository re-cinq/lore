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
