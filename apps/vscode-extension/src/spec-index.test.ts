import { describe, it, expect } from "vitest";
import type { SpecGraph } from "@re-cinq/lore-shared";
import {
  buildLocalIndex,
  buildCoverageIndex,
  mergeIndexes,
} from "./spec-index.js";

const SPEC_PATH = "specs/auth/spec.md";
const SPEC_CONTENT = `# Auth feature

## Functional Requirements

The runner claims a pending task before GKE picks it up.
([validated by \`runner.test.ts:88\`](mcp-server/src/local-runner.test.ts#L88), [code](mcp-server/src/local-runner.ts#L42))

Tasks survive rollout restarts via the lease backend.
([validated by \`lease.test.ts:42\`](agent/src/supervisor/lease.test.ts#L42))
`;

describe("buildLocalIndex", () => {
  const index = buildLocalIndex([{ path: SPEC_PATH, content: SPEC_CONTENT }]);

  it("highlights the implemented source line linked by an inline code link", () => {
    expect(index.get("mcp-server/src/local-runner.ts")).toEqual([
      {
        startLine: 42,
        endLine: 42,
        layer: "implemented",
        evidence: "human-linked",
        statementText:
          "The runner claims a pending task before GKE picks it up.",
        specPath: SPEC_PATH,
        specLine: 6,
        related: [
          {
            label: "validated by `runner.test.ts:88`",
            path: "mcp-server/src/local-runner.test.ts",
            line: 88,
          },
        ],
      },
    ]);
  });

  it("highlights the validating test line and relates it back to the code link", () => {
    expect(index.get("mcp-server/src/local-runner.test.ts")).toEqual([
      {
        startLine: 88,
        endLine: 88,
        layer: "implemented",
        evidence: "human-linked",
        statementText:
          "The runner claims a pending task before GKE picks it up.",
        specPath: SPEC_PATH,
        specLine: 6,
        related: [
          { label: "code", path: "mcp-server/src/local-runner.ts", line: 42 },
        ],
      },
    ]);
  });

  it("highlights a test-only statement with no related code links", () => {
    expect(index.get("agent/src/supervisor/lease.test.ts")).toEqual([
      {
        startLine: 42,
        endLine: 42,
        layer: "implemented",
        evidence: "human-linked",
        statementText: "Tasks survive rollout restarts via the lease backend.",
        specPath: SPEC_PATH,
        specLine: 9,
        related: [],
      },
    ]);
  });
});

describe("buildCoverageIndex", () => {
  const graph: SpecGraph = {
    nodes: [
      {
        id: "stmt1",
        type: "Statement",
        label: "",
        path: SPEC_PATH,
        detail: "The runner claims a pending task before GKE picks it up.",
      },
      {
        id: "test1",
        type: "TestChunk",
        label: "local-runner.test.ts",
        path: "mcp-server/src/local-runner.test.ts",
        line: 88,
        endLine: 95,
        detail: "claims a pending task",
      },
      {
        id: "file|mcp-server/src/local-runner.ts",
        type: "File",
        label: "local-runner.ts",
        path: "mcp-server/src/local-runner.ts",
        detail: "40-50",
      },
    ],
    links: [
      { source: "stmt1", target: "test1", kind: "validated_by" },
      {
        source: "test1",
        target: "file|mcp-server/src/local-runner.ts",
        kind: "covers",
      },
    ],
  };

  it("attributes a coverage range to the statement whose test exercised it", () => {
    expect(
      buildCoverageIndex(graph).get("mcp-server/src/local-runner.ts"),
    ).toEqual([
      {
        startLine: 40,
        endLine: 50,
        layer: "covered",
        evidence: "execution-verified",
        statementText:
          "The runner claims a pending task before GKE picks it up.",
        specPath: SPEC_PATH,
        specLine: 0,
        related: [
          {
            label: "local-runner.test.ts",
            path: "mcp-server/src/local-runner.test.ts",
            line: 88,
          },
        ],
      },
    ]);
  });

  it("ignores a covers link whose test has no validated_by statement", () => {
    const orphanGraph: SpecGraph = {
      nodes: [
        ...graph.nodes,
        {
          id: "test-orphan",
          type: "TestChunk",
          label: "orphan.test.ts",
          path: "mcp-server/src/orphan.test.ts",
          line: 3,
        },
        {
          id: "file|mcp-server/src/orphan.ts",
          type: "File",
          label: "orphan.ts",
          path: "mcp-server/src/orphan.ts",
          detail: "1-5",
        },
      ],
      links: [
        ...graph.links,
        { source: "stmt1", target: "test-orphan", kind: "implemented_by" },
        {
          source: "test-orphan",
          target: "file|mcp-server/src/orphan.ts",
          kind: "covers",
        },
      ],
    };

    expect(
      buildCoverageIndex(orphanGraph).get("mcp-server/src/orphan.ts"),
    ).toBeUndefined();
  });

  it("omits the related test when the covering test node has no path", () => {
    const pathlessTestGraph: SpecGraph = {
      nodes: [
        {
          id: "stmt1",
          type: "Statement",
          label: "",
          path: SPEC_PATH,
          detail: "The runner claims a pending task before GKE picks it up.",
        },
        {
          id: "test-pathless",
          type: "TestChunk",
          label: "local-runner.test.ts",
        },
        {
          id: "file|mcp-server/src/local-runner.ts",
          type: "File",
          label: "local-runner.ts",
          path: "mcp-server/src/local-runner.ts",
          detail: "40-50",
        },
      ],
      links: [
        { source: "stmt1", target: "test-pathless", kind: "validated_by" },
        {
          source: "test-pathless",
          target: "file|mcp-server/src/local-runner.ts",
          kind: "covers",
        },
      ],
    };

    expect(
      buildCoverageIndex(pathlessTestGraph).get(
        "mcp-server/src/local-runner.ts",
      ),
    ).toEqual([
      {
        startLine: 40,
        endLine: 50,
        layer: "covered",
        evidence: "execution-verified",
        statementText:
          "The runner claims a pending task before GKE picks it up.",
        specPath: SPEC_PATH,
        specLine: 0,
        related: [],
      },
    ]);
  });
});

describe("mergeIndexes", () => {
  const local = buildLocalIndex([{ path: SPEC_PATH, content: SPEC_CONTENT }]);
  const graph: SpecGraph = {
    nodes: [
      {
        id: "stmt1",
        type: "Statement",
        label: "",
        path: SPEC_PATH,
        detail: "The runner claims a pending task before GKE picks it up.",
      },
      {
        id: "test1",
        type: "TestChunk",
        label: "local-runner.test.ts",
        path: "mcp-server/src/local-runner.test.ts",
        line: 88,
      },
      {
        id: "file|mcp-server/src/local-runner.ts",
        type: "File",
        label: "local-runner.ts",
        path: "mcp-server/src/local-runner.ts",
        detail: "40-50",
      },
      {
        id: "stmt9",
        type: "Statement",
        label: "",
        path: SPEC_PATH,
        detail: "Leases expire after five minutes.",
      },
      {
        id: "test9",
        type: "TestChunk",
        label: "reaper.test.ts",
        path: "agent/src/jobs/lease-reaper.test.ts",
        line: 12,
      },
      {
        id: "file|agent/src/jobs/lease-reaper.ts",
        type: "File",
        label: "lease-reaper.ts",
        path: "agent/src/jobs/lease-reaper.ts",
        detail: "5-9",
      },
    ],
    links: [
      { source: "stmt1", target: "test1", kind: "validated_by" },
      {
        source: "test1",
        target: "file|mcp-server/src/local-runner.ts",
        kind: "covers",
      },
      { source: "stmt9", target: "test9", kind: "validated_by" },
      {
        source: "test9",
        target: "file|agent/src/jobs/lease-reaper.ts",
        kind: "covers",
      },
    ],
  };
  const merged = mergeIndexes(local, buildCoverageIndex(graph));

  it("drops a coverage entry when an inline link already covers the same statement and file", () => {
    expect(merged.get("mcp-server/src/local-runner.ts")).toEqual([
      {
        startLine: 42,
        endLine: 42,
        layer: "implemented",
        evidence: "human-linked",
        statementText:
          "The runner claims a pending task before GKE picks it up.",
        specPath: SPEC_PATH,
        specLine: 6,
        related: [
          {
            label: "validated by `runner.test.ts:88`",
            path: "mcp-server/src/local-runner.test.ts",
            line: 88,
          },
        ],
      },
    ]);
  });

  it("keeps a coverage entry that has no inline counterpart", () => {
    expect(merged.get("agent/src/jobs/lease-reaper.ts")).toEqual([
      {
        startLine: 5,
        endLine: 9,
        layer: "covered",
        evidence: "execution-verified",
        statementText: "Leases expire after five minutes.",
        specPath: SPEC_PATH,
        specLine: 0,
        related: [
          {
            label: "reaper.test.ts",
            path: "agent/src/jobs/lease-reaper.test.ts",
            line: 12,
          },
        ],
      },
    ]);
  });
});
