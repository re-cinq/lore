import { describe, it, expect } from "vitest";
import { resumeCutoffIndex, resolveResumePrefix } from "./resume.js";
import type {
  AssemblyLineNodeRecord,
  AssemblyLineRecord,
  AssemblyLineStartInput,
} from "./assembly-lines-port.js";

const HASH = "a".repeat(64);
const AT = new Date("2026-08-07T10:00:00Z");

function node(
  id: string,
  nodeId: string,
  iteration: number,
  outcome: string | null,
): AssemblyLineNodeRecord {
  return {
    id,
    assemblyLineId: "src",
    nodeId,
    iteration,
    outcome,
    agentCrName: `src12345678-${nodeId}`,
    commitSha: `sha-${id}`,
    startedAt: AT,
    finishedAt: outcome === null ? null : AT,
  };
}

function source(
  overrides: Partial<AssemblyLineRecord> = {},
): AssemblyLineRecord {
  return {
    id: "src",
    definitionName: "implementation",
    taskId: "task-9",
    repo: "re-cinq/lore",
    branch: "lore/implementation/x",
    args: { spec: "specs/x/spec.md" },
    status: "failed",
    outcome: "error",
    reason: "node failed",
    definitionHash: HASH,
    resumedFromLineId: null,
    resumedFromNodeId: null,
    createdAt: AT,
    startedAt: AT,
    finishedAt: AT,
    ...overrides,
  };
}

function input(
  overrides: Partial<AssemblyLineStartInput> = {},
): AssemblyLineStartInput {
  return {
    definitionName: "implementation",
    repo: "re-cinq/lore",
    definitionHash: HASH,
    resumeFrom: { lineId: "src", nodeId: "implement" },
    ...overrides,
  };
}

const NODES = [
  node("1", "implement", 1, "success"),
  node("2", "review", 1, "changes_requested"),
  node("3", "implement", 2, "success"),
  node("4", "review", 2, "failed"),
];

describe("resumeCutoffIndex", () => {
  it("returns the index of the latest completed row for the node", () => {
    expect(resumeCutoffIndex(NODES, "implement")).toBe(2);
    expect(resumeCutoffIndex(NODES, "review")).toBe(3);
  });

  it("returns -1 for a node the line never visited", () => {
    expect(resumeCutoffIndex(NODES, "retrospective")).toBe(-1);
  });

  it("returns -1 when every row for the node is still open", () => {
    expect(
      resumeCutoffIndex([node("1", "implement", 1, null)], "implement"),
    ).toBe(-1);
  });

  it("skips a later open row and returns the last completed one", () => {
    const nodes = [
      node("1", "implement", 1, "failed"),
      node("2", "implement", 2, null),
    ];

    expect(resumeCutoffIndex(nodes, "implement")).toBe(0);
  });
});

describe("resolveResumePrefix", () => {
  it("returns the rows through the chosen node's latest completed row, inclusive", () => {
    const prefix = resolveResumePrefix(input(), source(), NODES);

    expect(prefix.map((n) => `${n.nodeId}:${n.iteration}`)).toEqual([
      "implement:1",
      "review:1",
      "implement:2",
    ]);
  });

  it("carries the source rows through untouched, so the copy keeps their provenance", () => {
    const prefix = resolveResumePrefix(
      input({ resumeFrom: { lineId: "src", nodeId: "review" } }),
      source(),
      NODES,
    );

    expect(prefix.at(-1)).toMatchObject({
      nodeId: "review",
      iteration: 2,
      outcome: "failed",
      agentCrName: "src12345678-review",
      commitSha: "sha-4",
      finishedAt: AT,
    });
  });

  it("accepts a finished source line as readily as a failed one", () => {
    const finished = source({ status: "finished", outcome: "completed" });

    expect(resolveResumePrefix(input(), finished, NODES)).toHaveLength(3);
  });

  it("rejects a branch passed alongside resumeFrom", () => {
    expect(() =>
      resolveResumePrefix(input({ branch: "other" }), source(), NODES),
    ).toThrow(
      new Error(
        "resume-from start inherits branch from the source line — do not pass it",
      ),
    );
  });

  it("rejects a taskId passed alongside resumeFrom", () => {
    expect(() =>
      resolveResumePrefix(input({ taskId: "task-1" }), source(), NODES),
    ).toThrow(
      new Error(
        "resume-from start inherits taskId from the source line — do not pass it",
      ),
    );
  });

  it("rejects a resumeFrom start with no definition hash to compare", () => {
    expect(() =>
      resolveResumePrefix(
        input({ definitionHash: undefined }),
        source(),
        NODES,
      ),
    ).toThrow(
      new Error(
        "resume-from start requires definitionHash — the current definition's content hash",
      ),
    );
  });

  it("rejects a source line that does not exist", () => {
    expect(() => resolveResumePrefix(input(), null, [])).toThrow(
      new Error('resume-from source line "src" not found'),
    );
  });

  it("rejects a source line from another repo", () => {
    expect(() =>
      resolveResumePrefix(input({ repo: "re-cinq/other" }), source(), NODES),
    ).toThrow(
      new Error(
        'resume-from source line "src" belongs to repo "re-cinq/lore", not "re-cinq/other"',
      ),
    );
  });

  it("rejects a source line that ran another definition", () => {
    expect(() =>
      resolveResumePrefix(
        input({ definitionName: "code-review" }),
        source(),
        NODES,
      ),
    ).toThrow(
      new Error(
        'resume-from source line "src" ran definition "implementation", not "code-review"',
      ),
    );
  });

  it("rejects a queued or running source line, because the fork reuses its branch", () => {
    expect(() =>
      resolveResumePrefix(input(), source({ status: "running" }), NODES),
    ).toThrow(
      new Error(
        'resume-from source line "src" is still running — only a finished or failed line can be forked',
      ),
    );
    expect(() =>
      resolveResumePrefix(input(), source({ status: "queued" }), NODES),
    ).toThrow(/is still queued/);
  });

  it("rejects a source line whose definition hash was never stamped", () => {
    expect(() =>
      resolveResumePrefix(input(), source({ definitionHash: null }), NODES),
    ).toThrow(
      new Error(
        'resume-from source line "src" predates definition hashing — backfill pipeline.assembly_lines.definition_hash before forking it',
      ),
    );
  });

  it("rejects a source line whose definition hash differs from the current one", () => {
    const drifted = source({ definitionHash: "b".repeat(64) });

    expect(() => resolveResumePrefix(input(), drifted, NODES)).toThrow(
      /definition "implementation" has changed since that run \(bbbbbbbbbbbb ≠ aaaaaaaaaaaa\)/,
    );
  });

  it("rejects a node the source line never completed", () => {
    expect(() =>
      resolveResumePrefix(
        input({ resumeFrom: { lineId: "src", nodeId: "retrospective" } }),
        source(),
        NODES,
      ),
    ).toThrow(
      new Error(
        'resume-from source line "src" has no completed "retrospective" node to fork from',
      ),
    );
  });

  it("rejects a prefix holding an unfinished row, which would replay as a permanent await", () => {
    const nodes = [
      node("1", "implement", 1, null),
      node("2", "review", 1, "success"),
    ];

    expect(() =>
      resolveResumePrefix(
        input({ resumeFrom: { lineId: "src", nodeId: "review" } }),
        source(),
        nodes,
      ),
    ).toThrow(
      new Error(
        'resume-from source line "src" has an unfinished "implement" node inside the prefix — its history is not replayable',
      ),
    );
  });
});
