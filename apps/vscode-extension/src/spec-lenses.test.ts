import { describe, it, expect } from "vitest";
import { specLenses } from "./spec-lenses.js";

const SPEC_CONTENT = `# Auth feature

## Functional Requirements

The runner claims a pending task before GKE picks it up.
([validated by \`runner.test.ts:88\`](mcp-server/src/local-runner.test.ts#L88), [code](mcp-server/src/local-runner.ts#L42))

Tasks survive rollout restarts via the lease backend.
([validated by \`lease.test.ts:42\`](agent/src/supervisor/lease.test.ts#L42))
`;

describe("specLenses", () => {
  const lenses = specLenses(SPEC_CONTENT);

  it("emits one lens per spec line carrying inline links", () => {
    expect(lenses.map((l) => l.line)).toEqual([5, 8]);
  });

  it("splits a line's links into test and code targets", () => {
    expect(lenses[0]).toEqual({
      line: 5,
      tests: [{ label: "validated by `runner.test.ts:88`", path: "mcp-server/src/local-runner.test.ts", line: 88 }],
      code: [{ label: "code", path: "mcp-server/src/local-runner.ts", line: 42 }],
    });
  });

  it("emits a test-only lens with no code targets", () => {
    expect(lenses[1]).toEqual({
      line: 8,
      tests: [{ label: "validated by `lease.test.ts:42`", path: "agent/src/supervisor/lease.test.ts", line: 42 }],
      code: [],
    });
  });

  it("emits nothing for a spec with no inline links", () => {
    expect(specLenses("# Title\n\nJust prose, no links here.\n")).toEqual([]);
  });
});
