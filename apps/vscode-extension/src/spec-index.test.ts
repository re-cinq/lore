import { describe, it, expect } from "vitest";
import {
  buildLocalIndex,
  buildCoverageIndex,
  mergeIndexes,
  type CoveringTestRanges,
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
  it("returns one covered entry per range of src/a.ts a test ran, with its statement and test file", () => {
    expect(
      buildCoverageIndex("src/a.ts", [
        {
          testFile: "src/a.test.ts",
          statement: "Adds numbers.",
          ranges: [
            [3, 9],
            [20, 24],
          ],
        },
      ]).get("src/a.ts"),
    ).toEqual(
      [
        [3, 9],
        [20, 24],
      ].map(([startLine, endLine]) => ({
        startLine,
        endLine,
        layer: "covered",
        evidence: "execution-verified",
        statementText: "Adds numbers.",
        specPath: "",
        specLine: 0,
        related: [{ label: "a.test.ts", path: "src/a.test.ts", line: null }],
      })),
    );
  });

  it("returns nothing for a covering test that validates no statement", () => {
    expect(
      buildCoverageIndex("src/a.ts", [
        { testFile: "src/a.test.ts", ranges: [[3, 9]] },
      ]).get("src/a.ts"),
    ).toBeUndefined();
  });
});

describe("mergeIndexes", () => {
  const local = buildLocalIndex([{ path: SPEC_PATH, content: SPEC_CONTENT }]);
  const covering = (statement: string): CoveringTestRanges => ({
    testFile: "mcp-server/src/local-runner.test.ts",
    statement,
    ranges: [[40, 50]],
  });

  it("drops a coverage entry when an inline link already covers the same statement and file", () => {
    const merged = mergeIndexes(
      local,
      buildCoverageIndex("mcp-server/src/local-runner.ts", [
        covering("The runner claims a pending task before GKE picks it up."),
      ]),
    );

    expect(
      merged.get("mcp-server/src/local-runner.ts")?.map((entry) => entry.layer),
    ).toEqual(["implemented"]);
  });

  it("keeps a coverage entry that has no inline counterpart", () => {
    const merged = mergeIndexes(
      local,
      buildCoverageIndex("mcp-server/src/local-runner.ts", [
        covering("Leases expire after five minutes."),
      ]),
    );

    expect(
      merged.get("mcp-server/src/local-runner.ts")?.map((entry) => entry.layer),
    ).toEqual(["implemented", "covered"]);
  });
});
